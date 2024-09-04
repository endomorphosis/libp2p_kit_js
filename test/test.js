import { libp2pKitJs } from "../libp2p_kit_js/libp2p_kit.js"
// import { requireConfig } from "../config/config.js";
import path from "path";
import fs from "fs";
import os from "os";
import { exec, execSync } from "child_process";
import { t } from "tar";

export class test_libp2p_kit_js {
    constructor(resources, metadata) {
        this.imports = {};
        // this.config = requireConfig();
        this.libp2pKitJs = new libp2pKitJs();
    }

    async init() {
        let init_results = {};
        return init_results;
    }
    
    async test() {
        let test_results = {}
        console.log("Running tests for ipfs_accelerate_js/main.js");
        console.log("Running tests for ipfs_accelerate_js/index.js");
        console.log("Running tests for index.js");
        return test_results
    }
}

if (import.meta.url === 'file://' + process.argv[1]) {
    console.log("Running test");
    let test_results = {};
    try{
        const testLibp2pKitJs = new test_libp2p_kit_js();
        await testLibp2pKitJs.init().then((init) => {
            test_results.init = init;
            console.log("testIpfsModelManager init: ", init);
            testLibp2pKitJs.test().then((result) => {
                test_results.results = result;
                console.log("testIpfsModelManager: ", result);
            }).catch((error) => {
                test_results.results = error;
                console.log("testLibp2pKitJs error: ", error);
                // throw error;
            });
        }).catch((error) => {
            testLibp2pKitJs.init = error ;
            console.error("testLibp2pKitJs init error: ", error);
            // throw error;
            testLibp2pKitJs.test().then((result) => {
                test_results.results = result;
                console.log("testLibp2pKitJs: ", result);
            }).catch((error) => {
                test_results.results = error;
                console.log("testLibp2pKitJs error: ", error);
                // throw error;
            });
        });
        console.log(test_results);
        if (fs.existsSync("./tests") === false) {
            fs.mkdirSync("./tests");
        }
        if (fs.existsSync("./tests/test_results.json") === false) {
            fs.writeFileSync("./tests/test_results.json", JSON.stringify(test_results, null, 2));
        }
        fs.writeFileSync("./tests/test_results.json", JSON.stringify(test_results, null, 2));
        let testResultsFile = "./tests/README.md";
        let testResults = "";
        for (let key in test_results) {
            testResults += key + "\n";
            testResults += "```json\n";
            testResults += JSON.stringify(test_results[key], null, 2);
            testResults += "\n```\n";
        }
        fs.writeFileSync(testResultsFile, testResults);
        if (Object.keys(test_results).includes("test_results") === false) {
            process.exit(0);
        }
        else{
            process.exit(1);
        }   
    }
    catch(err){
        console.log(err);
        // process.exit(1);
    }   
}

export default test_libp2p_kit_js;