
import { scoped, Lifecycle} from 'tsyringe'

import { Contract, Gateway, GatewayOptions, Network } from 'fabric-network';
import * as path from 'path';

import FabricCAServices from 'fabric-ca-client';
import { Wallet, Wallets } from 'fabric-network';

import { IndyWallet } from '../../../wallet/IndyWallet'
import { IndyIssuerService } from '../../indy'
import { AgentConfig } from '../../../agent/AgentConfig'
import type { 
    default as Indy,
    LedgerRequest,
    NymRole,
    CredDef 
} from 'indy-sdk'
import { isIndyError } from '../../../utils/indyError'
import { IndySdkError } from '../../../error/IndySdkError'
import { CredentialDefinitionTemplate, SchemaTemplate } from './IndyLedgerService';

@scoped(Lifecycle.ContainerScoped)
export class FabricLedgerService {

    private channelName?: string
    private chaincodeName?: string
    private mspOrg?: string
    private walletPath: string
    private orgUserId?: string
    private ca?: string
    private department?: string
    private adminUserId?: string
    private adminUserPasswd?: string
    private network?: string

    private ccp?: Record<string, any>
    private caClient?: FabricCAServices
    private fabricWallet?: Wallet
    private gateway: Gateway
    private gatewayOpts?: GatewayOptions

    private indy: typeof Indy
    private indyWallet: IndyWallet
    private indyIssuer: IndyIssuerService

    public constructor(wallet: IndyWallet, agentConfig: AgentConfig, indyIssuer: IndyIssuerService
    ) {
        this.walletPath = path.join(__dirname, "wallet")
        this.gateway = new Gateway()
        this.indy = agentConfig.agentDependencies.indy
        this.indyWallet = wallet
        this.indyIssuer = indyIssuer
    }

    public async initializeClientApplication(
        channelName: string,
        chaincodeName: string,
        mspOrg: string,
        orgUserId: string,
        ca: string,
        department: string,
        adminUserId: string,
        adminUserPasswd: string,
        network: string
    ) {
        this.channelName = channelName
        this.chaincodeName = chaincodeName
        this.mspOrg = mspOrg
        this.orgUserId = orgUserId
        this.ca = ca
        this.department = department
        this.adminUserId = adminUserId
        this.adminUserPasswd = adminUserPasswd
        this.network = network
    }

    public async connectToFabric(contents: string) {
        
        let mspOrg = await this.getMspOrg()
        let orgUserId = await this.getOrgUserId()
        let ca = await this.getCa()
        let department = await this.getDepartment()
        let adminUserId = await this.getAdminUserId()
        let adminUserPasswd = await this.getAdminUserPasswd()
        
        this.fabricWallet = await this.buildWallet(this.walletPath)
        this.ccp = await this.buildCCPOrg(contents)

        this.caClient = await this.buildCAClient(this.ccp, ca)

        await this.enrollAdmin(this.caClient, this.fabricWallet, mspOrg, adminUserId, adminUserPasswd)

        await this.registerAndEnrollUser(this.caClient, this.fabricWallet, mspOrg, orgUserId, department, adminUserId)

        this.gatewayOpts = {
            wallet: this.fabricWallet,
            identity: orgUserId,
            discovery: { enabled: true, asLocalhost: true },
        };

    }

    private async buildWallet(walletPath: string): Promise<Wallet> {
        // Create a new  Fabric wallet : Note that wallet is for managing Fabric identities.
        let wallet: Wallet;
        if (walletPath) {
            wallet = await Wallets.newFileSystemWallet(walletPath);
            console.log(`Built a file system wallet at ${walletPath}`);
        } else {
            wallet = await Wallets.newInMemoryWallet();
            console.log('Built an in memory wallet');
        }
    
        return wallet;
    }

    private async buildCCPOrg(contents: string): Promise<Record<string, any>> {
    
        // Build a JSON object from the file contents
        const ccp = JSON.parse(contents);
        return ccp;
    }

    private async buildCAClient(ccp: Record<string, any>, caHostName: string): Promise<FabricCAServices> {
        // Create a new CA client for interacting with the CA.
        const caInfo = ccp.certificateAuthorities[caHostName]; // lookup CA details from config
        const caTLSCACerts = caInfo.tlsCACerts.pem;
        const caClient = new FabricCAServices(caInfo.url, { trustedRoots: caTLSCACerts, verify: false }, caInfo.caName);
    
        return caClient;
    }

    private async enrollAdmin (caClient: FabricCAServices, wallet: Wallet, orgMspId: string, adminUserId: string, adminUserPasswd: string): Promise<void> {
        try {
            // Check to see if we've already enrolled the admin user.
            const identity = await wallet.get(adminUserId);
            if (identity) {
                console.log('An identity for the admin user already exists in the wallet');
                return;
            }
    
            // Enroll the admin user, and import the new identity into the wallet.
            const enrollment = await caClient.enroll({ enrollmentID: adminUserId, enrollmentSecret: adminUserPasswd });
            const x509Identity = {
                credentials: {
                    certificate: enrollment.certificate,
                    privateKey: enrollment.key.toBytes(),
                },
                mspId: orgMspId,
                type: 'X.509',
            };
            await wallet.put(adminUserId, x509Identity);
            console.log('Successfully enrolled admin user and imported it into the wallet');
        } catch (error) {
            console.error(`Failed to enroll admin user : ${error}`);
        }
    }

    private async registerAndEnrollUser (caClient: FabricCAServices, wallet: Wallet, orgMspId: string, userId: string, affiliation: string, adminUserId: string): Promise<void> {
        try {
            // Check to see if we've already enrolled the user
            const userIdentity = await wallet.get(userId);
            if (userIdentity) {
                console.log(`An identity for the user ${userId} already exists in the wallet`);
                return;
            }
    
            // Must use an admin to register a new user
            const adminIdentity = await wallet.get(adminUserId);
            if (!adminIdentity) {
                console.log('An identity for the admin user does not exist in the wallet');
                console.log('Enroll the admin user before retrying');
                return;
            }
    
            // build a user object for authenticating with the CA
            const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
            const adminUser = await provider.getUserContext(adminIdentity, adminUserId);
    
            // Register the user, enroll the user, and import the new identity into the wallet.
            // if affiliation is specified by client, the affiliation value must be configured in CA
            const secret = await caClient.register({
                affiliation,
                enrollmentID: userId,
                role: 'client',
            }, adminUser);
            const enrollment = await caClient.enroll({
                enrollmentID: userId,
                enrollmentSecret: secret,
            });
            const x509Identity = {
                credentials: {
                    certificate: enrollment.certificate,
                    privateKey: enrollment.key.toBytes(),
                },
                mspId: orgMspId,
                type: 'X.509',
            };
            await wallet.put(userId, x509Identity);
            console.log(`Successfully registered and enrolled user ${userId} and imported it into the wallet`);
        } catch (error) {
            console.error(`Failed to register user : ${error}`);
        }
    }

    public async getChannelName(): Promise<string> {
        if(this.channelName)
        {
            return this.channelName
        }
        throw new Error("Channel Name is not defined")
    }

    public async getChaincodeName(): Promise<string> {
        if(this.chaincodeName)
        {
            return this.chaincodeName
        }
        throw new Error("Chaincode Name is not defined")
    }

    public async getMspOrg() : Promise<string> {
        if(this.mspOrg)
        {
            return this.mspOrg
        }
        throw new Error("MSP Org is not defined")
    }

    public async getOrgUserId() : Promise<string> {
        if(this.orgUserId)
        {
            return this.orgUserId
        }
        throw new Error("Org User Id is not defined")
    }
    
    public async getCa() : Promise<string> {
        if(this.ca)
        {
            return this.ca
        }
        throw new Error("Certificate Authority is not defined")
    }

    public async getDepartment() : Promise<string> {
        if(this.department)
        {
            return this.department
        }
        throw new Error("Department is not defined")
    }

    public async getAdminUserId() : Promise<string> {
        if(this.adminUserId)
        {
            return this.adminUserId
        }
        throw new Error("Admin User Id is not defined")
    }

    public async getAdminUserPasswd() : Promise<string> {
        if(this.adminUserPasswd)
        {
            return this.adminUserPasswd
        }
        throw new Error("Admin User Password is not defined")
    }

    public async getNetwork() : Promise<string> {
        if(this.network)
        {
            return this.network
        }
        throw new Error("Network is not defined")
    }

    public async getConnectionProfile(): Promise<Record<string, any>> {
        if(this.ccp)
        {
            return this.ccp
        }
        throw new Error("Connection profile is not defined'")
    }
    
    public async getGateway(): Promise<Gateway> {
        if(this.gateway)
        {
            return this.gateway
        }
        throw new Error("Gateway is not defined")        
    }

    public async getGatewayOptions(): Promise<GatewayOptions> {
        if(this.gatewayOpts)
        {
            return this.gatewayOpts
        }
        throw new Error("Gateway Options is not defined")
    }

    public async registerPublicDid(
        submitterDid: string,
        targetDid: string,
        verkey: string,
        alias: string,
        role?: NymRole
    ){  
        try {
            const request = await this.indy.buildNymRequest(submitterDid, targetDid, verkey, alias, role||null)
            await this.submitWriteRequest(request, submitterDid, "nym")
            
        return targetDid
        } catch(error) {
            throw error
        }
    }

    public async getPublicDid(did: string) {        
        const response = await this.readFromFabric(did, "nym")  
        var nym: Indy.GetNymResponse = JSON.parse(response)
        return nym      
    }


    public async registerSchema(did: string, schemaTemplate: SchemaTemplate){

        try {
            const { name, attributes, version } = schemaTemplate
            const schema = await this.indyIssuer.createSchema({ originDid: did, name, version, attributes })
            const request = await this.indy.buildSchemaRequest(did, schema)
            await this.submitWriteRequest(request, did, "schema")

            schema.seqNo = 0
            return schema
        } catch(error) {
            throw error
        }

    }

    public async getSchema(schemaId: string) {

        const response = await this.readFromFabric(schemaId, "schema")
        var schema: Indy.Schema = JSON.parse(response) 
        return schema

    }

    public async registerCredentialDefinition(
        did: string,
        credentialDefinitionTemplate: CredentialDefinitionTemplate
    ): Promise<CredDef> {
        try {

            const { schema, tag, signatureType, supportRevocation } = credentialDefinitionTemplate
            const credentialDefinition = await this.indyIssuer.createCredentialDefinition({
                issuerDid: did,
                schema,
                tag,
                signatureType,
                supportRevocation
            })

            const request = await this.indy.buildCredDefRequest(did, credentialDefinition)
            await this.submitWriteRequest(request, did, "credentialDefinition")

            return credentialDefinition

        } catch(error) {
            throw error
        }

    }

    public async getCredentialDefinition(
        credentialDefinitionId: string
    ) {

        const response = await this.readFromFabric(credentialDefinitionId, "credentialDefinition")
        var credentialDefinition: Indy.CredDef = JSON.parse(response)
        
        return  credentialDefinition

    }

    private async submitWriteRequest(request: LedgerRequest, signDid: string, type: string)
    {
        try {
            const signedRequest = await this.signRequest(signDid, request)

            let gateway:Gateway = await this.getGateway()
            let ccp:Record<string, any> = await this.getConnectionProfile()
            let gatewayOpts:GatewayOptions = await this.getGatewayOptions()
            let channelName:string = await this.getChannelName()
            let chaincodeName:string = await this.getChaincodeName()

            let networkName = ""
            if (type === "nym") {
                networkName = await this.getNetwork()
            }

            try{
                await gateway.connect(ccp, gatewayOpts)
                const network = await gateway.getNetwork(channelName)
                const contract = network.getContract(chaincodeName)

                const responseFromFabric = await contract.submitTransaction("CreateTransaction", JSON.stringify(signedRequest), type, networkName)

            } finally {
                gateway.disconnect()
            }
        } catch (error) {
            throw isIndyError(error) ? new IndySdkError(error) : error
        }

    }

    private async readFromFabric(id: string, type: string) {

        let gateway:Gateway = await this.getGateway()
        let ccp:Record<string, any> = await this.getConnectionProfile()
        let gatewayOpts:GatewayOptions = await this.getGatewayOptions()
        let channelName:string = await this.getChannelName()
        let chaincodeName:string = await this.getChaincodeName()

        try {

            await gateway.connect(ccp, gatewayOpts)
            const network = await gateway.getNetwork(channelName)
            const contract = network.getContract(chaincodeName)

            let result = await contract.evaluateTransaction("ReadTransaction", id, type)

            return result.toString()

        } finally {

            gateway.disconnect()

        }
    }

    private async signRequest(did: string, request: LedgerRequest): Promise<LedgerRequest>
    {
        try{
            return this.indy.signRequest(this.indyWallet.handle, did, request)
        } catch (error) {
            throw isIndyError(error) ? new IndySdkError(error) : error 
        }

    }


}
