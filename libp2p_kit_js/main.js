export class libp2pKitJs {
    constructor(resources, metadata) {
        this.resources = resources;
        this.metadata = metadata;
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