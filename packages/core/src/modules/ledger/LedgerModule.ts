import type { SchemaTemplate, CredentialDefinitionTemplate } from './services'
import type { NymRole } from 'indy-sdk'

import { inject, scoped, Lifecycle } from 'tsyringe'

import { InjectionSymbols } from '../../constants'
import { AriesFrameworkError } from '../../error'
import { Wallet } from '../../wallet/Wallet'

import { IndyLedgerService, FabricLedgerService } from './services'

@scoped(Lifecycle.ContainerScoped)
export class LedgerModule {
  private ledgerService: IndyLedgerService
  private wallet: Wallet
  private fabricLedgerService: FabricLedgerService

  public constructor(@inject(InjectionSymbols.Wallet) wallet: Wallet, ledgerService: IndyLedgerService, fabricLedgerService: FabricLedgerService) {
    this.ledgerService = ledgerService
    this.wallet = wallet
    this.fabricLedgerService = fabricLedgerService
  }

  public async getFabricLedgerService(): Promise<FabricLedgerService> {
    return this.fabricLedgerService    
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

    let ledger = await this.getFabricLedgerService()
    await ledger.initializeClientApplication(channelName, chaincodeName, mspOrg, orgUserId, ca, department, adminUserId, adminUserPasswd, network)

  }

  public async connectToFabric(contents: string) {

    let ledger = await this.getFabricLedgerService()
    await ledger.connectToFabric(contents)
  }

  public async registerPublicDid(did: string, verkey: string, alias: string, ledger: string, role?: NymRole) {
    const myPublicDid = this.wallet.publicDid?.did

    if (!myPublicDid) {
      throw new AriesFrameworkError('Agent has no public DID.')
    }

    switch(ledger) {
      case "indy":
        return await this.ledgerService.registerPublicDid(myPublicDid, did, verkey, alias, role)
      case "fabric":
        return await this.fabricLedgerService.registerPublicDid(myPublicDid, did, verkey, alias, role)
    }
    throw new Error(ledger + " as a ledger is not supported")
  }

  public async getPublicDid(did: string, ledger: string) {
    
    switch(ledger) {
      case "indy":
        return await this.ledgerService.getPublicDid(did)
      case "fabric":
        return await this.fabricLedgerService.getPublicDid(did)
    }
    throw new Error(ledger + " as a ledger is not supported")
  }

  public async registerSchema(schema: SchemaTemplate, ledger: string) {
    const did = this.wallet.publicDid?.did

    if (!did) {
      throw new AriesFrameworkError('Agent has no public DID.')
    }

    switch (ledger) {
      case "indy":
        return await this.ledgerService.registerSchema(did, schema)
      case "fabric":
        return await this.fabricLedgerService.registerSchema(did, schema)
    }

    throw new Error(ledger + " as a ledger is not supported")
  }

  public async getSchema(id: string, ledger: string) {
    
    switch(ledger) {
      case "indy":
        return this.ledgerService.getSchema(id)
      case "fabric":
        return await this.fabricLedgerService.getSchema(id)
    }

    throw new Error(ledger + " as a ledger is not suported")
  }

  public async registerCredentialDefinition(
    credentialDefinitionTemplate: Omit<CredentialDefinitionTemplate, 'signatureType'>, ledger: string
  ) {
    const did = this.wallet.publicDid?.did

    if (!did) {
      throw new AriesFrameworkError('Agent has no public DID.')
    }

    switch(ledger) {
      case "indy":
        return this.ledgerService.registerCredentialDefinition(did, {
          ...credentialDefinitionTemplate,
          signatureType: 'CL',
        })
      
      case "fabric":
        return await this.fabricLedgerService.registerCredentialDefinition(did, {
          ...credentialDefinitionTemplate,
          signatureType: 'CL'
        })
    }

    throw new Error(ledger + " as a ledger is not supported")
  }

  public async getCredentialDefinition(id: string, ledger: string) {

    switch(ledger)
    {
      case "indy":
        return this.ledgerService.getCredentialDefinition(id)
      
      case "fabric":
        return this.fabricLedgerService.getCredentialDefinition(id)

    }

    throw new Error(ledger + " as a ledger is not supported")
  }
}
