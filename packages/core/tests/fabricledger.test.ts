import * as indy from 'indy-sdk'

import { Agent } from '../src/agent/Agent'
import { sleep } from '../src/utils/sleep'

import { getBaseConfig } from './helpers'

import * as fs from 'fs';
import * as path from 'path';

const { config: faberConfig, agentDependencies: faberDependencies } = getBaseConfig('Faber Ledger')

describe('fabricledger', () => {
  let faberAgent: Agent
  let schemaId: indy.SchemaId

  beforeAll(async () => {
    faberAgent = new Agent(faberConfig, faberDependencies)
    await faberAgent.initialize()

    // The Path to connection json file, that would need to be changed.
    //const ccpPath = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'fabric-learning', 'example-fabric', 'fabric-samples', 'test-network', 'organizations', 'peerOrganizations', 'org1.example.com', 'connection-org1.json');

    const ccpPath = path.resolve(__dirname, 'connection-org1.json')

    const fileExists = fs.existsSync(ccpPath);
    if (!fileExists) {
      throw new Error(`no such file or directory: ${ccpPath}`);
    }
    const contents = fs.readFileSync(ccpPath, 'utf8');

    const contentJson = JSON.parse(contents)
    const network = contentJson["name"] 
        
    await faberAgent.ledger.initializeClientApplication("mychannel", "basic", "Org1MSP", "appUser1", "ca.org1.example.com", "org1.department1", "admin", "adminpw", network)
    await faberAgent.ledger.connectToFabric(contents)
  })

  afterAll(async () => {
    await faberAgent.shutdown({
      deleteWallet: true,
    })
  })

  test('register did on fabric ledger', async() => {

    if(!faberAgent.publicDid) {
      throw new Error(' Agent does not have public did.')
    }

    const targetDid = await faberAgent.ledger.registerPublicDid("TL1EaPFCZ8Si5aUrqScBDt", "~43X4NhAFqREffK7eWdKgFH", "alias", "fabric", "ENDORSER")

    await sleep(2000)
    const ledgerNym = await faberAgent.ledger.getPublicDid("did:test-network-org1:TL1EaPFCZ8Si5aUrqScBDt", "fabric")

    expect(ledgerNym).toEqual (
      expect.objectContaining({
        "did": "TL1EaPFCZ8Si5aUrqScBDt",
        "verkey": "~43X4NhAFqREffK7eWdKgFH",
        "role": "101"
      })
    )

  })

  test('register schema on fabric ledger', async () => {
    if (!faberAgent.publicDid) {
      throw new Error('Agent does not have public did.')
    }

    const schemaName = `test-schema-${Date.now()}`
    const schemaTemplate = {
      name: schemaName,
      attributes: ['name', 'age'],
      version: '1.0',
    }

    const schema = await faberAgent.ledger.registerSchema(schemaTemplate, "fabric")
    schemaId = schema.id

    await sleep(2000)
    const ledgerSchema = await faberAgent.ledger.getSchema(schemaId, "fabric")
    expect(schemaId).toBe(`${faberAgent.publicDid.did}:2:${schemaName}:1.0`)
    expect(ledgerSchema).toEqual(
       expect.objectContaining({
         attrNames: expect.arrayContaining(schemaTemplate.attributes),
         id: `${faberAgent.publicDid.did}:2:${schemaName}:1.0`,
         name: schemaName,
         seqNo: schema.seqNo,
         ver: schemaTemplate.version,
         version: schemaTemplate.version,
       })
     )
  })

  test('register definition on fabric ledger', async () => {
    if (!faberAgent.publicDid) {
      throw new Error('Agent does not have public did.')
    }
    const schema = await faberAgent.ledger.getSchema(schemaId, "fabric")
    const credentialDefinitionTemplate = {
      schema: schema,
      tag: 'TAG',
      signatureType: 'CL' as const,
      supportRevocation: true,
    }

    const credentialDefinition = await faberAgent.ledger.registerCredentialDefinition(credentialDefinitionTemplate, "fabric")

    await sleep(2000)

    const ledgerCredDef = await faberAgent.ledger.getCredentialDefinition(credentialDefinition.id, "fabric")

    const credDefIdRegExp = new RegExp(`${faberAgent.publicDid.did}:3:CL:[0-9]+:TAG`)
    expect(ledgerCredDef).toEqual(
      expect.objectContaining({
        id: "TL1EaPFCZ8Si5aUrqScBDt:3:CL:0:TAG",
        schemaId: String(schema.seqNo),
        type: credentialDefinitionTemplate.signatureType,
        tag: credentialDefinitionTemplate.tag,
        ver: '1.0',
        value: expect.objectContaining({
          primary: expect.anything(),
          revocation: expect.anything(),
        }),
      })
    )
  })

})
