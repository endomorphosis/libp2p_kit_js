import { s3Kit } from './s3_kit.js';

export class libp2pKitJs {
    constructor(resources, metadata) {
        this.resources = resources;
        this.metadata = metadata;
        this.s3Kit = new s3Kit(resources, metadata);
    }

    async init() {
        console.log('libp2pKitJs.init()');
        return this.test();
    }

    async test() {
        console.error('libp2pKitJs.test() not implemented');
        throw new Error('libp2pKitJs.test() not implemented');
    }
}
export default libp2pKitJs;