import { s3Kit } from './s3_kit.js';
import { websocketKit } from './websocket_kit.js';
import { aria2Kit } from './aria2_kit.js';
import { libp2pKit } from './libp2p.js';

export class libp2pKitJs {
    constructor(resources, metadata) {
        this.resources = resources;
        this.metadata = metadata;
        this.s3Kit = new s3Kit(resources, metadata);
        this.websocketKit = new websocketKit(resources, metadata);
        this.aria2Kit = new aria2Kit(resources, metadata )
        this.libp2pKit = new libp2pKit( resources, metadata )
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