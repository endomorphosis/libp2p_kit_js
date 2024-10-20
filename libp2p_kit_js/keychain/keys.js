import { derivePublicKey, generateKey } from './crypto.js'


export const privilegeTiers = ['admin', 'worker', 'client']

export async function generateAdminKeyChain(seed){
	return parseNetKey(`admin:${await generateKey(seed)}`)
}

export function parseNetKey(encodedNetKey){
	let [privilege, key] = encodedNetKey.split(':')
	let keychain = deriveKeyChain(
		key, 
		privilegeTiers.length - privilegeTiers.indexOf(privilege)
	)
	
	return {
		netId: keychain.at(-1),
		privilege,
		keychain
	}
}

function deriveKeyChain(key, num){
	let chain = [key]

	for(let i=0; i<num; i++){
		chain.push(derivePublicKey(chain.at(-1)))
	}

	return chain
}