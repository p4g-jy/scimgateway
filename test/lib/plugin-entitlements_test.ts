/**
 * Test file for Entitlements Plugin
 */

import { describe, it, expect } from 'bun:test'
import { EntitlementsPlugin } from '../../lib/plugin-entitlements'

describe('EntitlementsPlugin', () => {
  let plugin: EntitlementsPlugin

  beforeEach(() => {
    plugin = new EntitlementsPlugin()
  })

  describe('getEntitlements', () => {
    it('should return all entitlements when no filter is provided', async () => {
      const result = await plugin.getEntitlements('', {}, [])
      
      expect(result).toBeDefined()
      expect(result.Resources).toBeDefined()
      expect(Array.isArray(result.Resources)).toBe(true)
      expect(result.totalResults).toBeGreaterThan(0)
    })

    it('should filter entitlements by displayName', async () => {
      const result = await plugin.getEntitlements('', {
        attribute: 'displayName',
        operator: 'eq',
        value: 'Pro License'
      }, [])
      
      expect(result.Resources).toHaveLength(1)
      expect(result.Resources[0].displayName).toBe('Pro License')
    })

    it('should support paging', async () => {
      const result = await plugin.getEntitlements('', {
        startIndex: 1,
        count: 2
      }, [])
      
      expect(result.Resources).toHaveLength(2)
      expect(result.totalResults).toBeGreaterThanOrEqual(2)
    })
  })

  describe('listUserEntitlements', () => {
    it('should return empty array for user with no entitlements', async () => {
      const result = await plugin.listUserEntitlements('nonexistent')
      expect(result).toEqual([])
    })

    it('should return entitlements for existing user', async () => {
      const result = await plugin.listUserEntitlements('user1')
      expect(result).toContain('entitlement-123')
      expect(result).toContain('entitlement-789')
    })
  })

  describe('assignEntitlementToUser', () => {
    it('should assign entitlement to user', async () => {
      const result = await plugin.assignEntitlementToUser('user1', 'entitlement-456')
      expect(result).toBe(true)
      
      const entitlements = await plugin.listUserEntitlements('user1')
      expect(entitlements).toContain('entitlement-456')
    })

    it('should not assign duplicate entitlement', async () => {
      const result = await plugin.assignEntitlementToUser('user1', 'entitlement-123')
      expect(result).toBe(false)
    })
  })

  describe('removeEntitlementFromUser', () => {
    it('should remove entitlement from user', async () => {
      const result = await plugin.removeEntitlementFromUser('user1', 'entitlement-123')
      expect(result).toBe(true)
      
      const entitlements = await plugin.listUserEntitlements('user1')
      expect(entitlements).not.toContain('entitlement-123')
    })

    it('should return false for non-existent entitlement', async () => {
      const result = await plugin.removeEntitlementFromUser('user1', 'nonexistent')
      expect(result).toBe(false)
    })
  })
})
