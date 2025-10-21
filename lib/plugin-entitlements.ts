/**
 * Entitlements Plugin for SCIM Gateway
 * 
 * This plugin provides basic entitlements management functionality.
 * It can be extended to integrate with your actual entitlements system.
 */

import { ScimGateway } from './scimgateway'

export class EntitlementsPlugin extends ScimGateway {
  // Sample entitlements data - replace with your actual data source
  private entitlements = [
    {
      id: 'entitlement-123',
      displayName: 'Pro License',
      type: 'License',
      description: 'Professional license with full features'
    },
    {
      id: 'entitlement-456',
      displayName: 'Basic License',
      type: 'License',
      description: 'Basic license with limited features'
    },
    {
      id: 'entitlement-789',
      displayName: 'Admin Access',
      type: 'Permission',
      description: 'Administrative access to the system'
    }
  ]

  // Sample user entitlements mapping - replace with your actual data source
  private userEntitlements = new Map<string, string[]>([
    ['user1', ['entitlement-123', 'entitlement-789']],
    ['user2', ['entitlement-456']]
  ])

  /**
   * Get entitlements based on filter criteria
   */
  async getEntitlements(baseEntity: string, getObj: Record<string, any>, attributes: string[], ctx?: Record<string, any>) {
    let filteredEntitlements = [...this.entitlements]

    // Apply filtering if provided
    if (getObj.attribute && getObj.operator && getObj.value) {
      filteredEntitlements = filteredEntitlements.filter(entitlement => {
        const value = entitlement[getObj.attribute as keyof typeof entitlement]
        switch (getObj.operator) {
          case 'eq':
            return value === getObj.value
          case 'ne':
            return value !== getObj.value
          case 'co':
            return String(value).includes(getObj.value)
          case 'sw':
            return String(value).startsWith(getObj.value)
          case 'ew':
            return String(value).endsWith(getObj.value)
          default:
            return true
        }
      })
    }

    // Apply paging
    const startIndex = getObj.startIndex || 1
    const count = getObj.count || 100
    const start = Math.max(0, startIndex - 1)
    const end = start + count

    const pagedEntitlements = filteredEntitlements.slice(start, end)

    return {
      Resources: pagedEntitlements,
      totalResults: filteredEntitlements.length
    }
  }

  /**
   * Modify entitlement (for PATCH operations)
   */
  async modifyEntitlement(baseEntity: string, id: string, scimdata: Record<string, any>, ctx?: Record<string, any>) {
    // Find the entitlement
    const entitlementIndex = this.entitlements.findIndex(e => e.id === id)
    if (entitlementIndex === -1) {
      return null
    }

    // Update entitlement properties
    if (scimdata.displayName) {
      this.entitlements[entitlementIndex].displayName = scimdata.displayName
    }
    if (scimdata.type) {
      this.entitlements[entitlementIndex].type = scimdata.type
    }
    if (scimdata.description) {
      this.entitlements[entitlementIndex].description = scimdata.description
    }

    return this.entitlements[entitlementIndex]
  }

  /**
   * Get user entitlements
   */
  async listUserEntitlements(userId: string): Promise<string[]> {
    return this.userEntitlements.get(userId) || []
  }

  /**
   * Assign entitlement to user
   */
  async assignEntitlementToUser(userId: string, entitlementId: string): Promise<boolean> {
    const userEnts = this.userEntitlements.get(userId) || []
    if (!userEnts.includes(entitlementId)) {
      userEnts.push(entitlementId)
      this.userEntitlements.set(userId, userEnts)
      return true
    }
    return false
  }

  /**
   * Remove entitlement from user
   */
  async removeEntitlementFromUser(userId: string, entitlementId: string): Promise<boolean> {
    const userEnts = this.userEntitlements.get(userId) || []
    const index = userEnts.indexOf(entitlementId)
    if (index > -1) {
      userEnts.splice(index, 1)
      this.userEntitlements.set(userId, userEnts)
      return true
    }
    return false
  }

  /**
   * Get users with entitlements included
   */
  async getUsers(baseEntity: string, getObj: Record<string, any>, attributes: string[], ctx?: Record<string, any>) {
    // Call the parent getUsers method first
    const result = await super.getUsers(baseEntity, getObj, attributes, ctx)
    
    if (result && result.Resources) {
      // Add entitlements to each user
      for (const user of result.Resources) {
        const userEnts = await this.listUserEntitlements(user.id)
        user.entitlements = userEnts.map(entId => {
          const entitlement = this.entitlements.find(e => e.id === entId)
          return {
            value: entId,
            display: entitlement?.displayName || entId,
            type: entitlement?.type || 'License'
          }
        })
      }
    }

    return result
  }

  /**
   * Modify user (override to handle entitlements)
   */
  async modifyUser(baseEntity: string, id: string, scimdata: Record<string, any>, ctx?: Record<string, any>) {
    // Handle entitlements in the PATCH operation
    if (scimdata.entitlements && Array.isArray(scimdata.entitlements)) {
      for (const entitlement of scimdata.entitlements) {
        if (entitlement.operation === 'add') {
          await this.assignEntitlementToUser(id, entitlement.value)
        } else if (entitlement.operation === 'remove') {
          await this.removeEntitlementFromUser(id, entitlement.value)
        }
      }
    }

    // Call the parent modifyUser method for other attributes
    return await super.modifyUser(baseEntity, id, scimdata, ctx)
  }
}
