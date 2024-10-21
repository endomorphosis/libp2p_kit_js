export function bindStringToMultiaddrs({ 
	bind, 
	protocol = 'tcp', 
	defaultIP = '0.0.0.0', 
	defaultPort = 40000
}){
	if(typeof bind === 'number')
		bind = bind.toString()

	if(bind.charAt(0) === '/')
		return bind
	
	let parts = bind.split(',')
	let addresses = []

	for(let part of parts){
		let [ipDomainPort, port] = part.split(':')
		let isIP = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/.test(ipDomainPort)
		let isDomain = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/.test(ipDomainPort)
		let isPort = /^[0-9]+$/.test(ipDomainPort)

		if(!port && isPort){
			addresses.push(`/ip4/${defaultIP}/tcp/${ipDomainPort}`)
		}else if(isIP){
			addresses.push(`/ip4/${ipDomainPort}/tcp/${port || defaultPort}`)
		}else if(isDomain){
			addresses.push(`/dns4/${ipDomainPort}/tcp/${port || defaultPort}`)
		}else{
			throw new Error(`Invalid bind address: ${ipDomainPort}`)
		}
	}

	if(protocol === 'ws' || protocol === 'wss')
		addresses = addresses.map(addr => `${addr}/${protocol}`)
	
	return addresses
}