// NOTE: This is largely taken from Atom's `asar` patch here: https://raw.githubusercontent.com/electron/electron/master/lib/common/asar.js

const path = require('path')
const pkgmap = require('../pkgmap.js')
const util = require('util')

// Create a ENOENT error.
function notFoundError (filePath, callback) {
  const error = new Error(`ENOENT, ${filePath} not found`)
  error.code = 'ENOENT'
  error.errno = -2
  if (typeof callback !== 'function') {
    throw error
  }
  process.nextTick(() => callback(error))
}

// Create a ENOTDIR error.
function notDirError (callback) {
  const error = new Error('ENOTDIR, not a directory')
  error.code = 'ENOTDIR'
  error.errno = -20
  if (typeof callback !== 'function') {
    throw error
  }
  process.nextTick(() => callback(error))
}

// Override APIs that rely on passing file path instead of content to C++.
function overrideAPISync (module, name, arg) {
  if (arg == null) {
    arg = 0
  }
  const old = module[name]
  module[name] = function () {
    const p = arguments[arg]
    const resolved = pkgmap.resolve(p)
    if (resolved == null) { return old.apply(this, arguments) }
    if (!resolved) {
      notFoundError(p)
    }

    const stat = pkgmap.statSync(resolved, true)
    if (!stat) {
      notFoundError(p)
    }

    arguments[arg] = stat.cachePath
    return old.apply(this, arguments)
  }
}

const overrideAPI = function (module, name, arg) {
  if (arg == null) {
    arg = 0
  }
  const old = module[name]
  module[name] = function () {
    const p = arguments[arg]

    const callback = arguments[arguments.length - 1]
    if (typeof callback !== 'function') {
      return overrideAPISync(module, name, arg)
    }

    const resolved = pkgmap.resolve(p)
    if (resolved == null) { return old.apply(this, arguments) }
    if (!resolved) {
      notFoundError(p, callback)
    }

    const stat = pkgmap.statSync(resolved, true)
    if (!stat) {
      notFoundError(p, callback)
    }

    arguments[arg] = stat.cachePath
    return old.apply(this, arguments)
  }
  if (old[util.promisify.custom]) {
    module[name][util.promisify.custom] = async function () {
      const p = arguments[arg]
      const resolved = pkgmap.resolve(p)
      if (resolved == null) {
        return old[util.promisify.custom].apply(this, arguments)
      }
      if (!resolved) {
        notFoundError(p)
      }

      const stat = await pkgmap.stat(resolved, true)
      if (!stat) {
        notFoundError(p)
      }

      arguments[arg] = stat.cachePath
      return old[util.promisify.custom].apply(this, arguments)
    }
  }
}

// Override fs APIs.
module.exports.overrideNode = overrideNode
function overrideNode () {
  const fs = require('fs')

  const {lstatSync} = fs
  fs.lstatSync = function (p) {
    const resolved = pkgmap.resolve(p)
    if (resolved == null) { return lstatSync(p) }
    if (!resolved) {
      notFoundError(p)
    }
    const stats = pkgmap.statSync(resolved)
    if (!stats) {
      notFoundError(p)
    }
    return stats
  }

  const {lstat} = fs
  fs.lstat = function (p, callback) {
    const resolved = pkgmap.resolve(p)
    if (resolved == null) { return lstat(p, callback) }
    if (!resolved) {
      return notFoundError(p, callback)
    }
    pkgmap.stat(resolved).then(stat => {
      if (!stat) {
        notFoundError(p, callback)
      }
      callback(null, stat)
    }, callback)
  }

  const {statSync} = fs
  fs.statSync = function (p) {
    const resolved = pkgmap.resolve(p)
    if (resolved == null) { return statSync(p) }
    if (!resolved) {
      notFoundError(p)
    }
    const stats = pkgmap.statSync(resolved)
    if (!stats) {
      notFoundError(p)
    }
    return stats
  }

  const {stat} = fs
  fs.stat = function (p, callback) {
    const resolved = pkgmap.resolve(p)
    if (resolved == null) { return stat(p, callback) }
    if (!resolved) {
      return notFoundError(p, callback)
    }
    pkgmap.stat(resolved).then(stat => {
      if (!stat) {
        notFoundError(p, callback)
      }
      callback(null, stat)
    }, callback)
  }

  const {statSyncNoException} = fs
  fs.statSyncNoException = function (p) {
    const resolved = pkgmap.resolve(p)
    if (resolved == null) { return statSyncNoException(p) }
    if (!resolved) {
      return false
    }
    const stats = pkgmap.statSync(resolved)
    if (!stats) {
      return false
    }
    return stats
  }

  const {realpathSync} = fs
  fs.realpathSync = function (p) {
    const resolved = pkgmap.resolve(p)
    if (resolved == null) { return realpathSync.apply(this, arguments) }
    if (!resolved) {
      notFoundError(p)
    }
    return resolved.resolvedPath
  }

  const {realpath} = fs
  fs.realpath = function (p, cache, callback) {
    const resolved = pkgmap.resolve(p)
    if (resolved == null) { return realpath.apply(this, arguments) }
    if (typeof cache === 'function') {
      callback = cache
      cache = void 0
    }

    process.nextTick(() => {
      if (resolved) {
        return resolved.resolvedPath
      } else {
        notFoundError(p, callback)
      }
    })
  }

  const {exists} = fs // eslint-disable-line
  fs.exists = function (p, callback) { // eslint-disable-line
    const resolved = pkgmap.resolve(p)
    // pkgmap.resolve distinguishes returns null if no valid pkgmap was found,
    // and false if a map was found, but the file was not in it.
    if (resolved == null) { return exists(p, callback) }
    if (!resolved) { return process.nextTick(() => callback(null, false)) }
    process.nextTick(() => callback(null, true))
  }

  fs.exists[util.promisify.custom] = async (p) => { // eslint-disable-line
    const resolved = pkgmap.resolve(p)
    // pkgmap.resolve distinguishes returns null if no valid pkgmap was found,
    // and false if a map was found, but the file was not in it.
    if (resolved == null) { return exists[util.promisify.custom](p) }
    return !!resolved
  }

  const {existsSync} = fs
  fs.existsSync = function (p) {
    const resolved = pkgmap.resolve(p)
    // pkgmap.resolve distinguishes returns null if no valid pkgmap was found,
    // and false if a map was found, but the file was not in it.
    if (resolved == null) { return existsSync(p) }
    return !!resolved
  }

  const {access} = fs
  fs.access = function (p, mode, callback) {
    const resolved = pkgmap.resolve(p)
    if (resolved == null) { return access(p, mode, callback) }
    if (typeof mode === 'function') {
      callback = mode
      mode = fs.constants.F_OK
    }
    if (!resolved) {
      return notFoundError(p, callback)
    }
    pkgmap.stat(resolved).then(stat => {
      if (!stat) {
        return notFoundError(p, callback)
      }
      access(stat.cachePath, mode, callback)
    }, callback)
  }

  const {accessSync} = fs
  fs.accessSync = function (p, mode) {
    const resolved = pkgmap.resolve(p)
    if (resolved == null) { return accessSync(p, mode) }
    if (!resolved) {
      notFoundError(p)
    }
    if (mode == null) {
      mode = fs.constants.F_OK
    }
    const stat = pkgmap.statSync(resolved)
    if (!stat) {
      notFoundError(p)
    }
    return fs.accessSync(stat.cachePath, mode)
  }

  const {readFile} = fs
  fs.readFile = function (p, options, callback) {
    const resolved = pkgmap.resolve(p)
    if (resolved == null) { return readFile(p, options, callback) }
    if (typeof options === 'function') {
      callback = options
      options = {
        encoding: null
      }
    } else if (typeof options === 'string') {
      options = {
        encoding: options
      }
    } else if (options === null || options === undefined) {
      options = {
        encoding: null
      }
    } else if (typeof options !== 'object') {
      throw new TypeError('badarg')
    }
    if (!resolved) {
      return notFoundError(p, callback)
    }
    const {encoding} = options
    pkgmap.read(resolved).then(data => {
      if (encoding) {
        data = data.toString(encoding)
      }
      callback(null, data)
    }, callback)
  }

  const {readFileSync} = fs
  fs.readFileSync = function (p, options) {
    const resolved = pkgmap.resolve(p)
    if (resolved == null) { return readFileSync(p, options) }
    if (!resolved) {
      notFoundError(p)
    }
    if (!options) {
      options = {
        encoding: null
      }
    } else if (typeof options === 'string') {
      options = {
        encoding: options
      }
    } else if (typeof options !== 'object') {
      throw new TypeError('Bad arguments')
    }
    const {encoding} = options
    const data = pkgmap.readSync(resolved)
    if (encoding) {
      return data.toString(encoding)
    } else {
      return data
    }
  }

  function resolveDir (p) {
    p = p.replace(path.sep, '/')
    const prefix = p.match(/^[a-z:]?[/\\]+/gi)
    const parts = p.split(/[/\\]+/g).filter(x => x)
    if (prefix) {
      parts.unshift(prefix[0])
    }
    let resolved = null
    let wasFalse = false
    while (parts.length) {
      resolved = pkgmap.resolve(...parts, 'package.json')
      if (resolved || resolved == null) {
        break
      } else {
        wasFalse = true
        parts.pop()
      }
    }
    if (!resolved && !wasFalse) { return null }
    if (!resolved) { return false }
    resolved.resolvedPath = resolved.resolvedPath.replace(/package\.json$/, '')
    return resolved
  }

  function dirFiles (p) {
    const resolved = resolveDir(p)
    if (!resolved) { return resolved }
    const pkgPath = resolved.resolvedPath
    const dirPath = path.resolve(p).replace(/([/\\])?$/, '/')
      .replace(pkgPath, '')
    const files = Object.keys(resolved.pkg.files).reduce((acc, p) => {
      const match = p.replace(dirPath, 'PLACEHLDR').match(/PLACEHLDR([^/\\]+)/)
      if (match) {
        acc.add(match[1])
      }
      return acc
    }, new Set())
    return [...files]
  }

  const {readdir} = fs
  fs.readdir = function (p, callback) {
    const files = dirFiles(p)
    if (files == null) { return readdir(p, callback) }
    if (!files) { notFoundError(p, callback) }
    process.nextTick(() => callback(null, files))
  }

  const {readdirSync} = fs
  fs.readdirSync = function (p) {
    const files = dirFiles(p)
    if (files == null) { return readdirSync(p) }
    if (!files) { notFoundError(p) }
    return files
  }

  const {internalModuleReadJSON} = process.binding('fs')
  process.binding('fs').internalModuleReadJSON = function (p) {
    const resolved = pkgmap.resolve(p)
    if (resolved == null) { return internalModuleReadJSON(p) }
    if (!resolved) { return }
    try {
      return pkgmap.readSync(resolved).toString('utf8')
    } catch (err) {
    }
  }

  const {internalModuleStat} = process.binding('fs')
  process.binding('fs').internalModuleStat = function (p) {
    const resolved = pkgmap.resolve(p)
    if (resolved) { return 0 }
    if (resolved == null) { return internalModuleStat(p) }
    // NOTE: this is a dirty guesswork hack and we should really scan `files`
    //       in an existing package to find directories. This is probably
    //       good enough for our uses, though, and probably already faster
    //       than native.
    if (resolved === false) { return 1 }
    return -34
  }

  // Calling mkdir for directory inside asar archive should throw ENOTDIR
  // error, but on Windows it throws ENOENT.
  // This is to work around the recursive looping bug of mkdirp since it is
  // widely used.
  if (process.platform === 'win32') {
    const {mkdir} = fs
    fs.mkdir = function (p, mode, callback) {
      const resolved = pkgmap.resolve(p)
      if (resolved == null) { return mkdir(p, mode, callback) }
      if (typeof mode === 'function') {
        callback = mode
      }
      return notDirError(callback)
    }

    const {mkdirSync} = fs
    fs.mkdirSync = function (p, mode) {
      const resolved = pkgmap.resolve(p)
      if (resolved == null) { return mkdirSync(p, mode) }
      notDirError()
    }
  }

  overrideAPI(fs, 'open')
  overrideAPISync(process, 'dlopen', 1)
  overrideAPISync(require('module')._extensions, '.node', 1)
  overrideAPISync(fs, 'openSync')
}
