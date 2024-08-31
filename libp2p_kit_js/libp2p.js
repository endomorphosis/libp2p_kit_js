export class libp2pKit {
    constructor(resources, metadata) {
        this.resources = resources;
        this.metadata = metadata;
    }

    async init() {
        console.log('libp2pKit.init()');
        return this.test();
    }

    async test() {
        console.error('libp2pKit.test() not implemented');
        throw new Error('libp2pKit.test() not implemented');
    }
}