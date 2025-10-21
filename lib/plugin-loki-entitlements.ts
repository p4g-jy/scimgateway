// =================================================================================
// File:    plugin-loki-entitlements.ts
//
// Authors: Jarle Elshaug
//          Jeffrey Gilbert (visualjeff)
//          Extended for Okta SCIM 2.0 Entitlements
//
// Purpose: SCIM Gateway becomes a standalone SCIM endpoint with entitlements support
//          - Demonstrate userprovisioning towards a document-oriented database
//          - Using LokiJS (http://lokijs.org) for a fast, in-memory document-oriented database with persistence
//          - Two predefined test users loaded when using in-memory only (no persistence)
//          - Supporting explore, create, delete, modify and list users (including groups and entitlements)
//          - Full Okta SCIM 2.0 Entitlements support
//
// Supported attributes:
//
// GlobalUser   Template            Scim        Endpoint
// ------------------------------------------------------
// All attributes are supported, note multivalue "type" must be unique
// Entitlements are supported as multi-valued complex attributes
//
// NOTE: Default configuration file setting {"persistence": false} gives an inMemory adapter for testing purposes
//       having two predifiend users loaded. Using {"persistence": true} gives an persistence file store located in
//       config directory with name according to configuration setting {"dbname": "loki.db"} and no no testusers loaded.
//
//       LokiJS are well suited for handling large dataloads
//
// =================================================================================

import Loki from 'lokijs'
import path from 'node:path'

// start - mandatory plugin initialization
import { ScimGateway } from 'scimgateway'
const scimgateway = new ScimGateway()
const config = scimgateway.getConfig()
scimgateway.authPassThroughAllowed = false
// end - mandatory plugin initialization

const configDir = scimgateway.configDir
const validFilterOperators = ['eq', 'ne', 'aeq', 'dteq', 'gt', 'gte', 'lt', 'lte', 'between', 'jgt', 'jgte', 'jlt', 'jlte', 'jbetween', 'regex', 'in', 'nin', 'keyin', 'nkeyin', 'definedin', 'undefinedin', 'contains', 'containsAny', 'type', 'finite', 'size', 'len', 'exists']
const dbNames: string[] = []
for (const baseEntity in config.entity) {
  let dbname = config.entity[baseEntity].dbname || 'loki-entitlements.db'
  if (dbNames.includes(dbname)) {
    scimgateway.logError(baseEntity, `initialization error: database '${dbname}' is already used by another baseEntity configuration`)
    continue
  }
  dbNames.push(dbname)
  dbname = path.join(`${configDir}`, `${dbname}`)
  const isPersisence = config.entity[baseEntity].persistence !== false

  const loadHandler = () => {
    let users = db.getCollection('users')
    if (users === null) { // if database do not exist it will be empty so intitialize here
      users = db.addCollection('users', {
        unique: ['id', 'userName'],
      })
    }

    let groups = db.getCollection('groups')
    if (groups === null) {
      groups = db.addCollection('groups', {
        unique: ['displayName'],
      })
    }

    let entitlements = db.getCollection('entitlements')
    if (entitlements === null) {
      entitlements = db.addCollection('entitlements', {
        unique: ['id'],
        indices: ['id', 'type']
      })
    }

    if (!isPersisence) { // load testusers and entitlements
      scimgateway.getTestModeUsers().forEach((record) => {
        const r: any = scimgateway.copyObj(record)
        if (r.meta) delete r.meta
        users.insert(r)
      })
      scimgateway.getTestModeGroups().forEach((record) => {
        const r: any = scimgateway.copyObj(record)
        if (r.meta) delete r.meta
        groups.insert(r)
      })

      // Load test entitlements
      const testEntitlements = [
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
        },
        {
          id: 'entitlement-abc',
          displayName: 'Premium Support',
          type: 'Support',
          description: 'Premium customer support access'
        }
      ]

      testEntitlements.forEach((entitlement) => {
        entitlements.insert(entitlement)
      })

      // Add entitlements to test users
      const user1 = users.findOne({ userName: 'bjensen' })
      if (user1) {
        user1.entitlements = [
          {
            value: 'entitlement-123',
            display: 'Pro License',
            type: 'License',
            primary: true
          },
          {
            value: 'entitlement-789',
            display: 'Admin Access',
            type: 'Permission'
          }
        ]
        users.update(user1)
      }

      const user2 = users.findOne({ userName: 'jsmith' })
      if (user2) {
        user2.entitlements = [
          {
            value: 'entitlement-456',
            display: 'Basic License',
            type: 'License',
            primary: true
          }
        ]
        users.update(user2)
      }
    }

    config.entity[baseEntity].users = users
    config.entity[baseEntity].groups = groups
    config.entity[baseEntity].entitlements = entitlements
  }

  const db = new Loki(dbname, {
    env: 'NA', // avoid default NODEJS
    autoload: isPersisence,
    autoloadCallback: isPersisence ? loadHandler : undefined,
    autosave: isPersisence,
    autosaveInterval: 10000, // 10 seconds
    adapter: isPersisence ? new Loki.LokiFsAdapter() : new Loki.LokiMemoryAdapter(),
  })
  config.entity[baseEntity].db = db

  if (!isPersisence) loadHandler()
}

// =================================================
// getEntitlements
// =================================================
scimgateway.getEntitlements = async (baseEntity, getObj, attributes, ctx) => {
  const action = 'getEntitlements'
  scimgateway.logDebug(baseEntity, `handling ${action} getObj=${getObj ? JSON.stringify(getObj) : ''} attributes=${attributes} passThrough=${ctx ? 'true' : 'false'}`)

  if (!config.entity[baseEntity]) throw new Error(`unsupported baseEntity=${baseEntity}`)
  const entitlements = config.entity[baseEntity].entitlements

  if (getObj.operator) { // convert to plugin supported syntax
    switch (getObj.operator) {
      case 'co':
        getObj.operator = '$contains'
        break
      case 'ge':
        getObj.operator = '$gte'
        break
      case 'le':
        getObj.operator = '$lte'
        break
      case 'sw':
        getObj.operator = '$regex'
        getObj.value = new RegExp(`^${getObj.value}.*`)
        break
      case 'ew':
        getObj.operator = '$regex'
        getObj.value = new RegExp(`.*${getObj.value}$`)
        break
      default:
        if (!validFilterOperators.includes(getObj.operator)) {
          const err = new Error(`${action} error: filter operator '${getObj.operator}' is not valid, valid operators for this endpoint are: ${validFilterOperators}` + ',co,ge,le,sw,ew')
          err.name = 'invalidFilter' // maps to scimType error handling
          throw err
        }
        getObj.operator = '$' + getObj.operator
    }
  }

  let entitlementsArr: Record<string, any>[] | undefined

  // mandatory if-else logic - start
  if (getObj.operator) { // note, loki using prefix '$'
    if (getObj.operator === '$eq' && ['id', 'displayName', 'type'].includes(getObj.attribute)) {
      // mandatory - unique filtering - single unique entitlement to be returned
      const queryObj: any = {}
      if (getObj.attribute === 'id') queryObj[getObj.attribute] = getObj.value
      else queryObj[getObj.attribute] = { $regex: [`^${getObj.value}$`, 'i'] } // case insensitive
      entitlementsArr = entitlements.find(queryObj)
    } else {
      // optional - simple filtering
      const queryObj: any = {}
      queryObj[getObj.attribute] = { [getObj.operator]: getObj.value }
      entitlementsArr = entitlements.find(queryObj)
    }
  } else if (getObj.rawFilter) {
    // optional - advanced filtering having and/or/not - use getObj.rawFilter
    throw new Error(`${action} error: not supporting advanced filtering: ${getObj.rawFilter}`)
  } else {
    // mandatory - no filtering (!getObj.operator && !getObj.rawFilter) - all entitlements to be returned
    entitlementsArr = entitlements.data
  }
  // mandatory if-else logic - end

  const totalResults = entitlementsArr ? entitlementsArr.length : 0
  const startIndex = getObj.startIndex || 1
  const count = getObj.count || 100
  const start = Math.max(0, startIndex - 1)
  const end = start + count

  let result: Record<string, any>[] = []
  if (entitlementsArr) {
    result = entitlementsArr.slice(start, end)
  }

  scimgateway.logDebug(baseEntity, `${action} result: ${result.length} entitlements returned`)
  return {
    Resources: result,
    totalResults: totalResults
  }
}

// =================================================
// modifyEntitlement
// =================================================
scimgateway.modifyEntitlement = async (baseEntity, id, scimdata, ctx) => {
  const action = 'modifyEntitlement'
  scimgateway.logDebug(baseEntity, `handling ${action} id=${id} scimdata=${JSON.stringify(scimdata)} passThrough=${ctx ? 'true' : 'false'}`)

  if (!config.entity[baseEntity]) throw new Error(`unsupported baseEntity=${baseEntity}`)
  const entitlements = config.entity[baseEntity].entitlements

  const entitlement = entitlements.findOne({ id: id })
  if (!entitlement) {
    const err = new Error(`${action} error: entitlement id=${id} does not exist`)
    err.name = 'notFound' // maps to scimType error handling
    throw err
  }

  // Update entitlement properties
  if (scimdata.displayName !== undefined) entitlement.displayName = scimdata.displayName
  if (scimdata.type !== undefined) entitlement.type = scimdata.type
  if (scimdata.description !== undefined) entitlement.description = scimdata.description

  entitlements.update(entitlement)
  scimgateway.logDebug(baseEntity, `${action} result: entitlement updated`)

  return entitlement
}

// =================================================
// getUsers
// =================================================
scimgateway.getUsers = async (baseEntity, getObj, attributes, ctx) => {
  const action = 'getUsers'
  scimgateway.logDebug(baseEntity, `handling ${action} getObj=${getObj ? JSON.stringify(getObj) : ''} attributes=${attributes} passThrough=${ctx ? 'true' : 'false'}`)

  if (!config.entity[baseEntity]) throw new Error(`unsupported baseEntity=${baseEntity}`)
  const users = config.entity[baseEntity].users

  if (getObj.operator) { // convert to plugin supported syntax
    switch (getObj.operator) {
      case 'co':
        getObj.operator = '$contains'
        break
      case 'ge':
        getObj.operator = '$gte'
        break
      case 'le':
        getObj.operator = '$lte'
        break
      case 'sw':
        getObj.operator = '$regex'
        getObj.value = new RegExp(`^${getObj.value}.*`)
        break
      case 'ew':
        getObj.operator = '$regex'
        getObj.value = new RegExp(`.*${getObj.value}$`)
        break
      default:
        if (!validFilterOperators.includes(getObj.operator)) {
          const err = new Error(`${action} error: filter operator '${getObj.operator}' is not valid, valid operators for this endpoint are: ${validFilterOperators}` + ',co,ge,le,sw,ew')
          err.name = 'invalidFilter' // maps to scimType error handling
          throw err
        }
        getObj.operator = '$' + getObj.operator
    }
  }

  let usersArr: Record<string, any>[] | undefined

  // mandatory if-else logic - start
  if (getObj.operator) { // note, loki using prefix '$'
    if (getObj.operator === '$eq' && ['id', 'userName', 'externalId'].includes(getObj.attribute)) {
      // mandatory - unique filtering - single unique user to be returned - correspond to getUser() in versions < 4.x.x
      const queryObj: any = {}
      if (getObj.attribute === 'id') queryObj[getObj.attribute] = getObj.value
      else queryObj[getObj.attribute] = { $regex: [`^${getObj.value}$`, 'i'] } // case insensitive
      // new RegExp(`^${getObj.value}$`, 'i')
      usersArr = users.find(queryObj)
    } else if (getObj.operator === '$eq' && getObj.attribute === 'group.value') {
      // optional - only used when groups are member of users, not default behavior - correspond to getGroupUsers() in versions < 4.x.x
      const queryObj: any = {}
      queryObj[getObj.attribute] = getObj.value
      usersArr = users.chain().find(queryObj).data()
    } else {
      // optional - simple filtering
      const queryObj: any = {}
      queryObj[getObj.attribute] = { [getObj.operator]: getObj.value }
      usersArr = users.find(queryObj)
    }
  } else if (getObj.rawFilter) {
    // optional - advanced filtering having and/or/not - use getObj.rawFilter
    throw new Error(`${action} error: not supporting advanced filtering: ${getObj.rawFilter}`)
  } else {
    // mandatory - no filtering (!getObj.operator && !getObj.rawFilter) - all users to be returned - correspond to exploreUsers() in versions < 4.x.x
    usersArr = users.data
  }
  // mandatory if-else logic - end

  const totalResults = usersArr ? usersArr.length : 0
  const startIndex = getObj.startIndex || 1
  const count = getObj.count || 100
  const start = Math.max(0, startIndex - 1)
  const end = start + count

  let result: Record<string, any>[] = []
  if (usersArr) {
    result = usersArr.slice(start, end)
  }

  scimgateway.logDebug(baseEntity, `${action} result: ${result.length} users returned`)
  return {
    Resources: result,
    totalResults: totalResults
  }
}

// =================================================
// createUser
// =================================================
scimgateway.createUser = async (baseEntity, scimdata, ctx) => {
  const action = 'createUser'
  scimgateway.logDebug(baseEntity, `handling ${action} scimdata=${JSON.stringify(scimdata)} passThrough=${ctx ? 'true' : 'false'}`)

  if (!config.entity[baseEntity]) throw new Error(`unsupported baseEntity=${baseEntity}`)
  const users = config.entity[baseEntity].users

  if (!scimdata.userName) {
    const err = new Error(`${action} error: userName is required`)
    err.name = 'invalidValue' // maps to scimType error handling
    throw err
  }

  const existingUser = users.findOne({ userName: scimdata.userName })
  if (existingUser) {
    const err = new Error(`${action} error: user with userName '${scimdata.userName}' already exists`)
    err.name = 'uniqueness' // maps to scimType error handling
    throw err
  }

  const user: any = scimgateway.copyObj(scimdata)
  user.id = scimgateway.getUuid()
  user.meta = {
    resourceType: 'User',
    created: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    version: 'W/"1"'
  }

  users.insert(user)
  scimgateway.logDebug(baseEntity, `${action} result: user created with id=${user.id}`)

  return user
}

// =================================================
// deleteUser
// =================================================
scimgateway.deleteUser = async (baseEntity, id, ctx) => {
  const action = 'deleteUser'
  scimgateway.logDebug(baseEntity, `handling ${action} id=${id} passThrough=${ctx ? 'true' : 'false'}`)

  if (!config.entity[baseEntity]) throw new Error(`unsupported baseEntity=${baseEntity}`)
  const users = config.entity[baseEntity].users

  const user = users.findOne({ id: id })
  if (!user) {
    const err = new Error(`${action} error: user id=${id} does not exist`)
    err.name = 'notFound' // maps to scimType error handling
    throw err
  }

  users.remove(user)
  scimgateway.logDebug(baseEntity, `${action} result: user deleted`)

  return null
}

// =================================================
// modifyUser
// =================================================
scimgateway.modifyUser = async (baseEntity, id, scimdata, ctx) => {
  const action = 'modifyUser'
  scimgateway.logDebug(baseEntity, `handling ${action} id=${id} scimdata=${JSON.stringify(scimdata)} passThrough=${ctx ? 'true' : 'false'}`)

  if (!config.entity[baseEntity]) throw new Error(`unsupported baseEntity=${baseEntity}`)
  const users = config.entity[baseEntity].users

  const user = users.findOne({ id: id })
  if (!user) {
    const err = new Error(`${action} error: user id=${id} does not exist`)
    err.name = 'notFound' // maps to scimType error handling
    throw err
  }

  // Handle entitlements in PATCH operations
  if (scimdata.entitlements && Array.isArray(scimdata.entitlements)) {
    for (const entitlement of scimdata.entitlements) {
      if (entitlement.operation === 'add') {
        // Add entitlement to user
        if (!user.entitlements) user.entitlements = []
        const existingEntitlement = user.entitlements.find((e: any) => e.value === entitlement.value)
        if (!existingEntitlement) {
          user.entitlements.push({
            value: entitlement.value,
            display: entitlement.display || entitlement.value,
            type: entitlement.type || 'License',
            primary: entitlement.primary || false
          })
        }
      } else if (entitlement.operation === 'remove') {
        // Remove entitlement from user
        if (user.entitlements) {
          user.entitlements = user.entitlements.filter((e: any) => e.value !== entitlement.value)
        }
      }
    }
    // Remove entitlements from scimdata to avoid duplicate processing
    delete scimdata.entitlements
  }

  // Update other user properties
  Object.keys(scimdata).forEach(key => {
    if (key !== 'id' && key !== 'meta') {
      user[key] = scimdata[key]
    }
  })

  if (user.meta) {
    user.meta.lastModified = new Date().toISOString()
    user.meta.version = 'W/"' + (parseInt(user.meta.version?.replace('W/"', '').replace('"', '') || '0') + 1) + '"'
  }

  users.update(user)
  scimgateway.logDebug(baseEntity, `${action} result: user updated`)

  return user
}

// =================================================
// getGroups
// =================================================
scimgateway.getGroups = async (baseEntity, getObj, attributes, ctx) => {
  const action = 'getGroups'
  scimgateway.logDebug(baseEntity, `handling ${action} getObj=${getObj ? JSON.stringify(getObj) : ''} attributes=${attributes} passThrough=${ctx ? 'true' : 'false'}`)

  if (!config.entity[baseEntity]) throw new Error(`unsupported baseEntity=${baseEntity}`)
  const groups = config.entity[baseEntity].groups

  if (getObj.operator) { // convert to plugin supported syntax
    switch (getObj.operator) {
      case 'co':
        getObj.operator = '$contains'
        break
      case 'ge':
        getObj.operator = '$gte'
        break
      case 'le':
        getObj.operator = '$lte'
        break
      case 'sw':
        getObj.operator = '$regex'
        getObj.value = new RegExp(`^${getObj.value}.*`)
        break
      case 'ew':
        getObj.operator = '$regex'
        getObj.value = new RegExp(`.*${getObj.value}$`)
        break
      default:
        if (!validFilterOperators.includes(getObj.operator)) {
          const err = new Error(`${action} error: filter operator '${getObj.operator}' is not valid, valid operators for this endpoint are: ${validFilterOperators}` + ',co,ge,le,sw,ew')
          err.name = 'invalidFilter' // maps to scimType error handling
          throw err
        }
        getObj.operator = '$' + getObj.operator
    }
  }

  let groupsArr: Record<string, any>[] | undefined

  // mandatory if-else logic - start
  if (getObj.operator) { // note, loki using prefix '$'
    if (getObj.operator === '$eq' && ['id', 'displayName', 'externalId'].includes(getObj.attribute)) {
      // mandatory - unique filtering - single unique group to be returned - correspond to getGroup() in versions < 4.x.x
      const queryObj: any = {}
      if (getObj.attribute === 'id') queryObj[getObj.attribute] = getObj.value
      else queryObj[getObj.attribute] = { $regex: [`^${getObj.value}$`, 'i'] } // case insensitive
      groupsArr = groups.find(queryObj)
    } else if (getObj.operator === '$eq' && getObj.attribute === 'members.value') {
      // mandatory - return all groups the user 'id' (getObj.value) is member of - correspond to getGroupMembers() in versions < 4.x.x
      // Resources = [{ id: <id-group>> , displayName: <displayName-group>, members [{value: <id-user>}] }]
      const queryObj: any = {}
      queryObj[getObj.attribute] = getObj.value
      groupsArr = groups.chain().find(queryObj).data()
    } else {
      // optional - simple filtering
      const queryObj: any = {}
      queryObj[getObj.attribute] = { [getObj.operator]: getObj.value }
      groupsArr = groups.find(queryObj)
    }
  } else if (getObj.rawFilter) {
    // optional - advanced filtering having and/or/not - use getObj.rawFilter
    throw new Error(`${action} error: not supporting advanced filtering: ${getObj.rawFilter}`)
  } else {
    // mandatory - no filtering (!getObj.operator && !getObj.rawFilter) - all groups to be returned - correspond to exploreGroups() in versions < 4.x.x
    groupsArr = groups.data
  }
  // mandatory if-else logic - end

  const totalResults = groupsArr ? groupsArr.length : 0
  const startIndex = getObj.startIndex || 1
  const count = getObj.count || 100
  const start = Math.max(0, startIndex - 1)
  const end = start + count

  let result: Record<string, any>[] = []
  if (groupsArr) {
    result = groupsArr.slice(start, end)
  }

  scimgateway.logDebug(baseEntity, `${action} result: ${result.length} groups returned`)
  return {
    Resources: result,
    totalResults: totalResults
  }
}

// =================================================
// createGroup
// =================================================
scimgateway.createGroup = async (baseEntity, scimdata, ctx) => {
  const action = 'createGroup'
  scimgateway.logDebug(baseEntity, `handling ${action} scimdata=${JSON.stringify(scimdata)} passThrough=${ctx ? 'true' : 'false'}`)

  if (!config.entity[baseEntity]) throw new Error(`unsupported baseEntity=${baseEntity}`)
  const groups = config.entity[baseEntity].groups

  if (!scimdata.displayName) {
    const err = new Error(`${action} error: displayName is required`)
    err.name = 'invalidValue' // maps to scimType error handling
    throw err
  }

  const existingGroup = groups.findOne({ displayName: scimdata.displayName })
  if (existingGroup) {
    const err = new Error(`${action} error: group with displayName '${scimdata.displayName}' already exists`)
    err.name = 'uniqueness' // maps to scimType error handling
    throw err
  }

  const group: any = scimgateway.copyObj(scimdata)
  group.id = scimgateway.getUuid()
  group.meta = {
    resourceType: 'Group',
    created: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    version: 'W/"1"'
  }

  groups.insert(group)
  scimgateway.logDebug(baseEntity, `${action} result: group created with id=${group.id}`)

  return group
}

// =================================================
// deleteGroup
// =================================================
scimgateway.deleteGroup = async (baseEntity, id, ctx) => {
  const action = 'deleteGroup'
  scimgateway.logDebug(baseEntity, `handling ${action} id=${id} passThrough=${ctx ? 'true' : 'false'}`)

  if (!config.entity[baseEntity]) throw new Error(`unsupported baseEntity=${baseEntity}`)
  const groups = config.entity[baseEntity].groups

  const group = groups.findOne({ id: id })
  if (!group) {
    const err = new Error(`${action} error: group id=${id} does not exist`)
    err.name = 'notFound' // maps to scimType error handling
    throw err
  }

  groups.remove(group)
  scimgateway.logDebug(baseEntity, `${action} result: group deleted`)

  return null
}

// =================================================
// modifyGroup
// =================================================
scimgateway.modifyGroup = async (baseEntity, id, scimdata, ctx) => {
  const action = 'modifyGroup'
  scimgateway.logDebug(baseEntity, `handling ${action} id=${id} scimdata=${JSON.stringify(scimdata)} passThrough=${ctx ? 'true' : 'false'}`)

  if (!config.entity[baseEntity]) throw new Error(`unsupported baseEntity=${baseEntity}`)
  const groups = config.entity[baseEntity].groups

  const group = groups.findOne({ id: id })
  if (!group) {
    const err = new Error(`${action} error: group id=${id} does not exist`)
    err.name = 'notFound' // maps to scimType error handling
    throw err
  }

  // Update group properties
  Object.keys(scimdata).forEach(key => {
    if (key !== 'id' && key !== 'meta') {
      group[key] = scimdata[key]
    }
  })

  if (group.meta) {
    group.meta.lastModified = new Date().toISOString()
    group.meta.version = 'W/"' + (parseInt(group.meta.version?.replace('W/"', '').replace('"', '') || '0') + 1) + '"'
  }

  groups.update(group)
  scimgateway.logDebug(baseEntity, `${action} result: group updated`)

  return group
}

export { scimgateway as PluginLokiEntitlements }
