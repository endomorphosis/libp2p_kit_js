export class aria2Kit {
    constructor(resources, metadata) {
        this.resources = resources;
        this.metadata = metadata;
    }

    async init() {
        console.log('ariaKit.init()');
        return this.test();
    }

    async test() {
        console.error('ariaKit.test() not implemented');
        throw new Error('ariaKit.test() not implemented');
    }
}
export default aria2Kit;