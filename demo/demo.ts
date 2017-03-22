import { FaceAPI } from 'swagger-cognitive-sevices';
import { PersonGroupMulti } from '../src/index';
import * as fs from 'fs';

const ocpApimSubscriptionKey = '<your subscription key smth like Y2F0c3RvcnVsZXRoZXdvcmxkLg0K>';

const faceAPI = new FaceAPI();
faceAPI.globalHeaderParameters = {
    ocpApimSubscriptionKey: ocpApimSubscriptionKey
}
const personGroupMulti = new PersonGroupMulti({ ocpApimSubscriptionKey, maxRetryPerOperation: 2 });

const timeout = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const doDemoAsync = async () => {
    const billPerson = await personGroupMulti.addPersonAsync('bill');
    // simulating first personGroup ovefrlow
    (personGroupMulti as any)._personGroups[0].personsCount = 1000;

    const satyaPerson = await personGroupMulti.addPersonAsync('satya');
    // simulating second personGroup ovefrlow
    (personGroupMulti as any)._personGroups[1].personsCount = 1000;

    const dalailamaPerson = await personGroupMulti.addPersonAsync('dalailama');

    const bill = (await faceAPI.personAddAPersonFacePost({}, {}, billPerson).type('application/octet-stream').send(fs.readFileSync(`${__dirname}/bill.jpg`))).body;
    const satya = (await faceAPI.personAddAPersonFacePost({}, {}, satyaPerson).type('application/octet-stream').send(fs.readFileSync(`${__dirname}/satya.jpg`))).body;
    const dalailama = (await faceAPI.personAddAPersonFacePost({}, {}, dalailamaPerson).type('application/octet-stream').send(fs.readFileSync(`${__dirname}/dalailama.jpg`))).body;

    const personGroupIds = Array.from([billPerson, satyaPerson, dalailamaPerson].reduce((set, current) => {
        set.add(current.personGroupId);
        return set;
    }, new Set()));

    await Promise.all(personGroupIds.map(async (id) => {
        await faceAPI.personGroupTrainPersonGroupPost({}, {}, { personGroupId: id });
    }));

    await Promise.all(personGroupIds.map(async (id) => {
        const queryStatus = async (): Promise<boolean> => {
            const trainintStatus = (await faceAPI.personGroupGetPersonGroupTrainingStatusGet({}, {}, { personGroupId: id })).body;
            if (trainintStatus.status === 'succeeded') {
                return true;
            }
            if (trainintStatus.status === 'failed') {
                throw trainintStatus;
            }
            await timeout(1000);
            return await queryStatus();
        };
        return await queryStatus();
    }))
    
    // now let's identify !
    const billFace = (await faceAPI.faceDetectPost({}, {}).type('application/octet-stream').send(fs.readFileSync(`${__dirname}/bill.jpg`))).body[0];
    const satyaFace = (await faceAPI.faceDetectPost({}, {}).type('application/octet-stream').send(fs.readFileSync(`${__dirname}/satya.jpg`))).body[0];
    const dalailamaFace = (await faceAPI.faceDetectPost({}, {}).type('application/octet-stream').send(fs.readFileSync(`${__dirname}/dalailama.jpg`))).body[0];

    const billFaceIdentifyResult = await personGroupMulti.identifyPersonAsync({ faceIds: [billFace.faceId] });
    const satyaFacedentifyResult = await personGroupMulti.identifyPersonAsync({ faceIds: [satyaFace.faceId] });
    const dalailamaFaceIdentifyResult = await personGroupMulti.identifyPersonAsync({ faceIds: [dalailamaFace.faceId] });

    console.log(billFaceIdentifyResult);
    console.log(satyaFacedentifyResult)
    console.log(dalailamaFaceIdentifyResult)
}

doDemoAsync();