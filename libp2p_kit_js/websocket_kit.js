export class websocketKit {
    constructor(resources, metadata) {
        this.resources = resources;
        this.metadata = metadata;
    }

    async init() {
        console.log('websocketKit.init()');
        return this.test();
    }

    async test() {
        console.error('websocketKit.test() not implemented');
        throw new Error('websocketKit.test() not implemented');
    }
}
export default websocketKit;