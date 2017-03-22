import { FaceAPI } from 'swagger-cognitive-sevices/dist/index';
import { PersonGroupGetAPersonGroupGetResult } from 'swagger-cognitive-sevices/dist/api/face'

interface PersonGroup extends PersonGroupGetAPersonGroupGetResult {
    personsCount: number;
}

interface FaceAPIError {
    status: number,
    response: {
        body: {
            error: {
                code: string,
                message: string
            }
        }
    }
};

interface PersonIdentifyResultPart {
    faceId: string,
    candidates: { personId: string, confidence: number }
}

interface PersonIdentifyResultPartMulti extends PersonIdentifyResultPart {
    personGroupId: string
}

const timeoutAsync = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

type PersonIdentifyResult = PersonIdentifyResultPart[];
type PersonIdentifyResultMulti = PersonIdentifyResultPartMulti[];

export interface PersonGroupMultiConstructorParams {
    /**
     * ocpApimSubscriptionKey your ocpApimSubscriptionKey for FaceAPI cognitve services
     */
    ocpApimSubscriptionKey: string,
    /**
     * personGroupPrefix prefix for name of person groups. All person groups ids age generated like 'personGroupPrefix + i' where i is the number of person groups
     */
    personGroupPrefix?: string,
    /**
     * personGroupLimit maximum persons per group. Note that this api relies on errors from FaceAPI and doesn't really use this param. It's used only in init process to get inital info about person groups
     */
    personGroupLimit?: number,
    /**
     * maxRetryPerOperation maximum amount of retries for operations before error will be thrown
     */
    maxRetryPerOperation?: number,
    /**
     * retryTimeout timeout in ms before retry attempt
     */
    retryTimeout?: number
}

export class PersonGroupMulti {
    private _faceAPI = new FaceAPI();
    private _personGroups: PersonGroup[] = [];
    private _personGroupPrefix: string;
    private _personGroupLimit: number;
    private _maxRetryPerOperation: number;
    private _retryTimeout: number;

    /**
     * @param ocpApimSubscriptionKey your ocpApimSubscriptionKey for FaceAPI cognitve services
     * @param personGroupPrefix prefix for name of person groups. All person groups ids age generated like 'personGroupPrefix + i' where i is the number of person groups
     * @param personGroupLimit maximum persons per group. Note that this api relies on errors from FaceAPI and doesn't really use this param. It's used only in init process to get inital info about person groups
     * @param maxRetryPerOperation maximum amount of retries for operations before error will be thrown
     * @param retryTimeout timeout in ms before retry attempt
     */
    constructor({ ocpApimSubscriptionKey, personGroupPrefix = 'person-group-multi', personGroupLimit = 1000, maxRetryPerOperation = 5, retryTimeout = 100 }: PersonGroupMultiConstructorParams) {
        this._faceAPI.globalHeaderParameters = {
            ocpApimSubscriptionKey: ocpApimSubscriptionKey
        }
        this._personGroupPrefix = personGroupPrefix;
        this._personGroupLimit = personGroupLimit;
        this._retryTimeout = retryTimeout;
    }

    async initAsync(): Promise<PersonGroupMulti> {
        const personGroupList = (await this._faceAPI.personGroupListPersonGroupsGet({}, {})).body;
        this._personGroups = (await Promise.all(personGroupList.map(async (pG) => {
            const personsCount = (await this._faceAPI.personListPersonsInAPersonGroupGet({}, {}, { personGroupId: pG.personGroupId })).body.length;
            return { ...pG, personsCount };
        }))).sort((a, b) => { // 3, 2, 1 order
            return -(a.personsCount - b.personsCount);
        });

        return null;
    }

    /**
     * Adds person to the one of the person groups.
     * @param personName name of the person to add
     */
    public async addPersonAsync(personName: string, retryCount = 0): Promise<{ personId: string, personGroupId: string }> {
        //we try to find a person group with personsCount less than _personGroupLimit. 
        //Note: this doesn't guarantee that this the person group we found actually isn't full yet
        //But it's 'good enough' guess
        let pG = this._personGroups.find((pG) => {
            return pG.personsCount < this._personGroupLimit;
        });
        if (!pG) {
            pG = await this.getNewPersonGroupAsync();
        }
        try {
            const person = await this._faceAPI.personCreateAPersonPost({}, {}, { personGroupId: pG.personGroupId }).send({ name: personName });
            return { personId: person.body.personId, personGroupId: pG.personGroupId };
        } catch (e) {
            if (retryCount === this._maxRetryPerOperation) {
                throw e;
            }
            console.log(`Error while adding person ${personName}`, e);
            const error = e as FaceAPIError;
            if (error.status === 403) { //Person number reached subscription level limit or person group level limit. Maximum person count per person group is 1000. Maximum person count per subscription is 1000 for free tier and can be greater for paid tier.
                //let's try to create new person group. We need to mark this one as full. 
                console.log(`Reached subscription level limit or person group level limit for group ${pG.personGroupId}`);
                pG.personsCount = this._personGroupLimit;
                timeoutAsync(this._retryTimeout);
                return this.addPersonAsync(personName, retryCount + 1);
            }
            if (error.status === 409 || error.status === 429) { //'The person group is still under training. Try again after training completed.' or 'Concurrent operation conflict on resource.'
                console.log('The person group is still under training. or' +
                    'Concurrent operation conflict on resource. or' +
                    'Rate limit is exceeded. ' +
                    `Retrying to create person ${personName}`);
                timeoutAsync(this._retryTimeout);
                return this.addPersonAsync(personName, retryCount + 1);
            }

            throw e;//we need to rethrow for Promise to fail
        }
    }

    public async identifyPersonAsync(params: { faceIds: string[], maxNumOfCandidatesReturned?: number, confidenceThreshold?: number }, retryCount = 0): Promise<PersonIdentifyResultMulti> {
        //we need to get person groups list before identifying, we cannot rely on local _personGroups list.
        let personGroupList;
        try {
            personGroupList = (await this._faceAPI.personGroupListPersonGroupsGet({}, {})).body;
        } catch (e) {
            console.log(`Error while trying to get list of person groups.`);
            const error = e as FaceAPIError;
            if (~[403, 409, 429].indexOf(error.status)) {
                timeoutAsync(this._retryTimeout);
                return this.identifyPersonAsync(params, retryCount + 1);
            }
            throw e;
        }
        //now we need to find faces inside each personGroup. Oh my. Brace for the limit quotas.                    
        const result = await Promise.all(personGroupList.map(async (pG) => {
            const result = await this._faceIdentifyPostWithRetryAsync({ ...params, personGroupId: pG.personGroupId });
            return result.map((r) => ({ ...r, personGroupId: pG.personGroupId }));
        }));
        const resToReturn: PersonIdentifyResultMulti = result.reduce((prev, r) => {
            return prev.concat(r);
        }, []);
        return resToReturn;
    }

    /**
     * Creates new next person group
     */
    public async getNewPersonGroupAsync(retryCount = 0): Promise<PersonGroup> {
        const personGroupId = `${this._personGroupPrefix}${this._personGroups.length}`;
        const pGResult = {
            personGroupId: personGroupId,
            name: personGroupId,
            userData: '',
            personsCount: 0 // it doesn't really matter, because we just need to know that is 'probably' not full 
        };
        try {
            const pG = (await this._faceAPI.personGroupCreateAPersonGroupPut({}, {}, { personGroupId }).send({ name: personGroupId })).body;
            this._personGroups.push(pGResult);
            return pGResult;
        } catch (e) {
            console.log(`Error while trying to create ${personGroupId} person group.`);
            if (retryCount === this._maxRetryPerOperation) {
                throw e;
            }

            const error = e as FaceAPIError;
            if (error.status === 429) { // Rate limit is exceeded.
                console.log(`Rate limit is exceeded while trying to create ${personGroupId} person group.`);
                timeoutAsync(this._retryTimeout);
                return await this.getNewPersonGroupAsync(retryCount + 1);
            }
            if (error.status === 409) { //PersonGroupExists	Person group already exists. or ConcurrentOperationConflict	Concurrent operation conflict on resource.                
                if (error.response.body.error.code === 'PersonGroupExists') {
                    console.log(`${personGroupId} person group already exists.`);
                    this._personGroups.push(pGResult);
                    return pGResult;
                } else {
                    //ConcurrentOperationConflict
                    timeoutAsync(this._retryTimeout);
                    return await this.getNewPersonGroupAsync(retryCount + 1);
                }
            }
            throw e; //we need to rethrow for Promise to fail
        }
    }

    private async _faceIdentifyPostWithRetryAsync(params: { faceIds: string[], maxNumOfCandidatesReturned?: number, confidenceThreshold?: number, personGroupId: string }, retryCount = 0): Promise<PersonIdentifyResult> {
        try {
            const identfyResult = await this._faceAPI.faceIdentifyPost({}, {}).send(
                { ...params }
            );
            return identfyResult.body as PersonIdentifyResult;
        } catch (e) {
            console.log(`Error while identifyPerson ${params.faceIds.join()} in ${params.personGroupId} person group.`);
            if (retryCount === this._maxRetryPerOperation) {
                throw e;
            }
            const error = e as FaceAPIError;

            if (~[403/*Out of call volume quota.*/,
                409/*Person group 'sample_group' is under training.*/,
                429/*Rate limit is exceeded.*/].indexOf(error.status)) {
                timeoutAsync(this._retryTimeout);
                return this._faceIdentifyPostWithRetryAsync(params, retryCount + 1);
            }
        }
    }
}



