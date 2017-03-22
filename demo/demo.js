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
const swagger_cognitive_sevices_1 = require("swagger-cognitive-sevices");
const index_1 = require("../src/index");
const fs = require("fs");
const ocpApimSubscriptionKey = '<your subscription key smth like Y2F0c3RvcnVsZXRoZXdvcmxkLg0K>';
const faceAPI = new swagger_cognitive_sevices_1.FaceAPI();
faceAPI.globalHeaderParameters = {
    ocpApimSubscriptionKey: ocpApimSubscriptionKey
};
const personGroupMulti = new index_1.PersonGroupMulti({ ocpApimSubscriptionKey, maxRetryPerOperation: 2 });
const timeout = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};
const doDemoAsync = () => __awaiter(this, void 0, void 0, function* () {
    const billPerson = yield personGroupMulti.addPersonAsync('bill');
    // simulating first personGroup ovefrlow
    personGroupMulti._personGroups[0].personsCount = 1000;
    const satyaPerson = yield personGroupMulti.addPersonAsync('satya');
    // simulating second personGroup ovefrlow
    personGroupMulti._personGroups[1].personsCount = 1000;
    const dalailamaPerson = yield personGroupMulti.addPersonAsync('dalailama');
    const bill = (yield faceAPI.personAddAPersonFacePost({}, {}, billPerson).type('application/octet-stream').send(fs.readFileSync(`${__dirname}/bill.jpg`))).body;
    const satya = (yield faceAPI.personAddAPersonFacePost({}, {}, satyaPerson).type('application/octet-stream').send(fs.readFileSync(`${__dirname}/satya.jpg`))).body;
    const dalailama = (yield faceAPI.personAddAPersonFacePost({}, {}, dalailamaPerson).type('application/octet-stream').send(fs.readFileSync(`${__dirname}/dalailama.jpg`))).body;
    const personGroupIds = Array.from([billPerson, satyaPerson, dalailamaPerson].reduce((set, current) => {
        set.add(current.personGroupId);
        return set;
    }, new Set()));
    yield Promise.all(personGroupIds.map((id) => __awaiter(this, void 0, void 0, function* () {
        yield faceAPI.personGroupTrainPersonGroupPost({}, {}, { personGroupId: id });
    })));
    yield Promise.all(personGroupIds.map((id) => __awaiter(this, void 0, void 0, function* () {
        const queryStatus = () => __awaiter(this, void 0, void 0, function* () {
            const trainintStatus = (yield faceAPI.personGroupGetPersonGroupTrainingStatusGet({}, {}, { personGroupId: id })).body;
            if (trainintStatus.status === 'succeeded') {
                return true;
            }
            if (trainintStatus.status === 'failed') {
                throw trainintStatus;
            }
            yield timeout(1000);
            return yield queryStatus();
        });
        return yield queryStatus();
    })));
    // now let's identify !
    const billFace = (yield faceAPI.faceDetectPost({}, {}).type('application/octet-stream').send(fs.readFileSync(`${__dirname}/bill.jpg`))).body[0];
    const satyaFace = (yield faceAPI.faceDetectPost({}, {}).type('application/octet-stream').send(fs.readFileSync(`${__dirname}/satya.jpg`))).body[0];
    const dalailamaFace = (yield faceAPI.faceDetectPost({}, {}).type('application/octet-stream').send(fs.readFileSync(`${__dirname}/dalailama.jpg`))).body[0];
    const billFaceIdentifyResult = yield personGroupMulti.identifyPersonAsync({ faceIds: [billFace.faceId] });
    const satyaFacedentifyResult = yield personGroupMulti.identifyPersonAsync({ faceIds: [satyaFace.faceId] });
    const dalailamaFaceIdentifyResult = yield personGroupMulti.identifyPersonAsync({ faceIds: [dalailamaFace.faceId] });
    console.log(billFaceIdentifyResult);
    console.log(satyaFacedentifyResult);
    console.log(dalailamaFaceIdentifyResult);
});
doDemoAsync();
//# sourceMappingURL=demo.js.map