"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("swagger-cognitive-sevices/dist/index");
;
const timeoutAsync = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};
class PersonGroupMulti {
    /**
     * @param ocpApimSubscriptionKey your ocpApimSubscriptionKey for FaceAPI cognitve services
     * @param personGroupPrefix prefix for name of person groups. All person groups ids age generated like 'personGroupPrefix + i' where i is the number of person groups
     * @param personGroupLimit maximum persons per group. Note that this api relies on errors from FaceAPI and doesn't really use this param. It's used only in init process to get inital info about person groups
     * @param maxRetryPerOperation maximum amount of retries for operations before error will be thrown
     * @param retryTimeout timeout in ms before retry attempt
     */
    constructor({ ocpApimSubscriptionKey, personGroupPrefix = 'person-group-multi', personGroupLimit = 1000, maxRetryPerOperation = 5, retryTimeout = 100 }) {
        this._faceAPI = new index_1.FaceAPI();
        this._personGroups = [];
        this._faceAPI.globalHeaderParameters = {
            ocpApimSubscriptionKey: ocpApimSubscriptionKey
        };
        this._personGroupPrefix = personGroupPrefix;
        this._personGroupLimit = personGroupLimit;
        this._retryTimeout = retryTimeout;
    }
    initAsync() {
        return __awaiter(this, void 0, void 0, function* () {
            const personGroupList = (yield this._faceAPI.personGroupListPersonGroupsGet({}, {})).body;
            this._personGroups = (yield Promise.all(personGroupList.map((pG) => __awaiter(this, void 0, void 0, function* () {
                const personsCount = (yield this._faceAPI.personListPersonsInAPersonGroupGet({}, {}, { personGroupId: pG.personGroupId })).body.length;
                return Object.assign({}, pG, { personsCount });
            })))).sort((a, b) => {
                return -(a.personsCount - b.personsCount);
            });
            return null;
        });
    }
    /**
     * Adds person to the one of the person groups.
     * @param personName name of the person to add
     */
    addPersonAsync(personName, retryCount = 0) {
        return __awaiter(this, void 0, void 0, function* () {
            //we try to find a person group with personsCount less than _personGroupLimit. 
            //Note: this doesn't guarantee that this the person group we found actually isn't full yet
            //But it's 'good enough' guess
            let pG = this._personGroups.find((pG) => {
                return pG.personsCount < this._personGroupLimit;
            });
            if (!pG) {
                pG = yield this.getNewPersonGroupAsync();
            }
            try {
                const person = yield this._faceAPI.personCreateAPersonPost({}, {}, { personGroupId: pG.personGroupId }).send({ name: personName });
                return { personId: person.body.personId, personGroupId: pG.personGroupId };
            }
            catch (e) {
                if (retryCount === this._maxRetryPerOperation) {
                    throw e;
                }
                console.log(`Error while adding person ${personName}`, e);
                const error = e;
                if (error.status === 403) {
                    //let's try to create new person group. We need to mark this one as full. 
                    console.log(`Reached subscription level limit or person group level limit for group ${pG.personGroupId}`);
                    pG.personsCount = this._personGroupLimit;
                    timeoutAsync(this._retryTimeout);
                    return this.addPersonAsync(personName, retryCount + 1);
                }
                if (error.status === 409 || error.status === 429) {
                    console.log('The person group is still under training. or' +
                        'Concurrent operation conflict on resource. or' +
                        'Rate limit is exceeded. ' +
                        `Retrying to create person ${personName}`);
                    timeoutAsync(this._retryTimeout);
                    return this.addPersonAsync(personName, retryCount + 1);
                }
                throw e; //we need to rethrow for Promise to fail
            }
        });
    }
    identifyPersonAsync(params, retryCount = 0) {
        return __awaiter(this, void 0, void 0, function* () {
            //we need to get person groups list before identifying, we cannot rely on local _personGroups list.
            let personGroupList;
            try {
                personGroupList = (yield this._faceAPI.personGroupListPersonGroupsGet({}, {})).body;
            }
            catch (e) {
                console.log(`Error while trying to get list of person groups.`);
                const error = e;
                if (~[403, 409, 429].indexOf(error.status)) {
                    timeoutAsync(this._retryTimeout);
                    return this.identifyPersonAsync(params, retryCount + 1);
                }
                throw e;
            }
            //now we need to find faces inside each personGroup. Oh my. Brace for the limit quotas.                    
            const result = yield Promise.all(personGroupList.map((pG) => __awaiter(this, void 0, void 0, function* () {
                const result = yield this._faceIdentifyPostWithRetryAsync(Object.assign({}, params, { personGroupId: pG.personGroupId }));
                return result.map((r) => (Object.assign({}, r, { personGroupId: pG.personGroupId })));
            })));
            const resToReturn = result.reduce((prev, r) => {
                return prev.concat(r);
            }, []);
            return resToReturn;
        });
    }
    /**
     * Creates new next person group
     */
    getNewPersonGroupAsync(retryCount = 0) {
        return __awaiter(this, void 0, void 0, function* () {
            const personGroupId = `${this._personGroupPrefix}${this._personGroups.length}`;
            const pGResult = {
                personGroupId: personGroupId,
                name: personGroupId,
                userData: '',
                personsCount: 0 // it doesn't really matter, because we just need to know that is 'probably' not full 
            };
            try {
                const pG = (yield this._faceAPI.personGroupCreateAPersonGroupPut({}, {}, { personGroupId }).send({ name: personGroupId })).body;
                this._personGroups.push(pGResult);
                return pGResult;
            }
            catch (e) {
                console.log(`Error while trying to create ${personGroupId} person group.`);
                if (retryCount === this._maxRetryPerOperation) {
                    throw e;
                }
                const error = e;
                if (error.status === 429) {
                    console.log(`Rate limit is exceeded while trying to create ${personGroupId} person group.`);
                    timeoutAsync(this._retryTimeout);
                    return yield this.getNewPersonGroupAsync(retryCount + 1);
                }
                if (error.status === 409) {
                    if (error.response.body.error.code === 'PersonGroupExists') {
                        console.log(`${personGroupId} person group already exists.`);
                        this._personGroups.push(pGResult);
                        return pGResult;
                    }
                    else {
                        //ConcurrentOperationConflict
                        timeoutAsync(this._retryTimeout);
                        return yield this.getNewPersonGroupAsync(retryCount + 1);
                    }
                }
                throw e; //we need to rethrow for Promise to fail
            }
        });
    }
    _faceIdentifyPostWithRetryAsync(params, retryCount = 0) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const identfyResult = yield this._faceAPI.faceIdentifyPost({}, {}).send(Object.assign({}, params));
                return identfyResult.body;
            }
            catch (e) {
                console.log(`Error while identifyPerson ${params.faceIds.join()} in ${params.personGroupId} person group.`);
                if (retryCount === this._maxRetryPerOperation) {
                    throw e;
                }
                const error = e;
                if (~[403 /*Out of call volume quota.*/,
                    409 /*Person group 'sample_group' is under training.*/,
                    429 /*Rate limit is exceeded.*/].indexOf(error.status)) {
                    timeoutAsync(this._retryTimeout);
                    return this._faceIdentifyPostWithRetryAsync(params, retryCount + 1);
                }
            }
        });
    }
}
exports.PersonGroupMulti = PersonGroupMulti;
//# sourceMappingURL=index.js.map