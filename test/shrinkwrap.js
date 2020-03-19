const Shrinkwrap = require('../lib/shrinkwrap.js')
const Node = require('../lib/node.js')
const Link = require('../lib/link.js')
const calcDepFlags = require('../lib/calc-dep-flags.js')
const mutateFS = require('mutate-fs')

const t = require('tap')

t.cleanSnapshot = s => s.split(process.cwd()).join('{CWD}')

const {relative, resolve, basename} = require('path')
const fixture = resolve(__dirname, 'fixtures/install-types')
const swonlyFixture = resolve(__dirname, 'fixtures/install-types-sw-only')
const YarnLock = require('../lib/yarn-lock.js')
const yarnFixture = resolve(__dirname, 'fixtures/yarn-stuff')
const emptyFixture = resolve(__dirname, 'fixtures/empty')
const depTypesFixture = resolve(__dirname, 'fixtures/dev-deps')
const badJsonFixture = resolve(__dirname, 'fixtures/testing-peer-deps-bad-sw')
const hiddenLockfileFixture = resolve(__dirname, 'fixtures/hidden-lockfile')

t.test('path defaults to .', async t => {
  const sw = new Shrinkwrap()
  t.equal(sw.path, process.cwd())
})

t.test('load and then reset gets empty lockfile', t =>
  Shrinkwrap.load({ path: fixture }).then(sw => {
    sw.reset()
    t.strictSame(sw.data, {
      lockfileVersion: 2,
      requires: true,
      dependencies: {},
      packages: {},
    })
    t.equal(sw.loadedFromDisk, true)
    t.equal(sw.filename, resolve(fixture, 'package-lock.json'))
  }))

t.test('loading in bad dir gets empty lockfile', t =>
  Shrinkwrap.load({ path: 'path/which/does/not/exist' }).then(sw => {
    t.strictSame(sw.data, {
      lockfileVersion: 2,
      requires: true,
      dependencies: {},
      packages: {},
    })
    t.equal(sw.loadedFromDisk, false)
  }))

t.test('failure to parse json gets empty lockfile', t =>
  Shrinkwrap.load({ path: badJsonFixture }).then(sw => {
    t.strictSame(sw.data, {
      lockfileVersion: 2,
      requires: true,
      dependencies: {},
      packages: {},
    })
    t.equal(sw.loadedFromDisk, false)
  }))

t.test('loading in empty dir gets empty lockfile', t =>
  Shrinkwrap.load({ path: emptyFixture }).then(sw => {
    t.strictSame(sw.data, {
      lockfileVersion: 2,
      requires: true,
      dependencies: {},
      packages: {},
    })
    t.equal(sw.loadedFromDisk, false)
    // update with an empty node, set name to node name, not package name
    const root = new Node({
      path: emptyFixture,
      realpath: emptyFixture,
    })
    root.peer = root.dev = root.devOptional = root.optional = root.extraneous = false
    sw.add(root)
    t.strictSame(sw.commit(), {
      name: 'empty',
      lockfileVersion: 2,
      requires: true,
      dependencies: {},
      packages: {
        '': {},
      },
    })
  }))

t.test('look up from locks and such', t =>
  new Shrinkwrap({ path: fixture }).load().then(m => {
    t.strictSame(m.get(''), {
      name: 'a',
      version: '1.2.3',
      dependencies: {
        "abbrev": "^1.1.1",
        "full-git-url": "git+https://github.com/isaacs/abbrev-js.git",
        "ghshort": "github:isaacs/abbrev-js",
        "old": "npm:abbrev@^1.0.3",
        "pinned": "npm:abbrev@^1.1.1",
        "reg": "npm:abbrev@^1.1.1",
        "remote": "https://registry.npmjs.org/abbrev/-/abbrev-1.1.1.tgz",
        "symlink": "file:./abbrev-link-target",
        "tarball": "file:abbrev-1.1.1.tgz",
        "bundler": "1.2.3",
      },
    }, 'root metadata')
    t.match(m.data, {
      lockfileVersion: 2,
      requires: true,
      dependencies: Object,
      packages: Object,
    })
    t.equal(m.loadedFromDisk, true)
    t.matchSnapshot(m.get('node_modules/abbrev'), 'basic package')
    t.matchSnapshot(m.get(
      'node_modules/abbrev/node_modules/@scope/name/node_modules/@otherscope/othername', 'scoped package'))
    t.matchSnapshot(m.get('package/not/found'), 'not found')

    t.matchSnapshot(m.get('node_modules/old/node_modules/notfound'), 'fall off the dep tree')

    t.test('lockfile', t => {
      const p = m.data.packages
      m.data.packages = {}
      t.matchSnapshot(m.get('node_modules/abbrev'), 'basic pkg, from lock')
      t.matchSnapshot(m.data.packages, 'saved fetched metadata back to packages section')
      t.matchSnapshot(m.get(
        'node_modules/abbrev/node_modules/@scope/name/node_modules/@otherscope/othername', 'scoped package'))
      t.matchSnapshot(m.get('package/not/found'), 'not found')
      t.matchSnapshot(m.get('node_modules/full-git-url'), 'full git')
      t.matchSnapshot(m.get('node_modules/symlink'), 'symlink')
      t.matchSnapshot(m.get('node_modules/unhosted-git'), 'unhosted git')
      m.data.packages = p
      t.end()
    })
  }))

t.test('load a shrinkwrap with some dev and optional flags', t =>
  Shrinkwrap.load({path: depTypesFixture}).then(m =>
    t.matchSnapshot(m.data, 'got expected dependency types')))

t.test('load a legacy shrinkwrap without a package.json', t =>
  Shrinkwrap.load({path: swonlyFixture}).then(m =>
    t.matchSnapshot(m.data, 'did our best with what we had')))

t.test('throws when attempting to access data before loading', t => {
  t.throws(() =>
    new Shrinkwrap().get(), Error('run load() before getting or setting data'))
  t.throws(() =>
    new Shrinkwrap().delete(), Error('run load() before getting or setting data'))
  t.throws(() =>
    new Shrinkwrap().add(), Error('run load() before getting or setting data'))
  t.throws(() =>
    new Shrinkwrap().save(), Error('run load() before saving data'))
  t.end()
})

t.test('construct metadata from node and package data', t => {
  const meta = new Shrinkwrap({ path: '/home/user/projects/root' })
  // fake load
  meta.data = {
    lockfileVersion: 2,
    requires: true,
    dependencies: {},
    packages: {},
  }

  const root = new Node({
    pkg: {
      name: 'root',
      dependencies: { a: '', link: '', link2: '' },
      devDependencies: { d: '', e: 'https://foo.com/e.tgz', devit: '' },
      optionalDependencies: { optin: '' },
      peerDependencies: { peer: '' },
      scripts: {
        install: 'true',
      },
    },
    path: '/home/user/projects/root',
    realpath: '/home/user/projects/root',
    meta,
  })

  const peer = new Node({
    pkg: {
      name: 'peer',
      version: '1.2.3',
      dependencies: { peerdep: '' },
    },
    resolved: 'https://peer.com/peer.tgz',
    integrity: 'sha512-peerpeerpeer',
    parent: root,
  })

  const peerdep = new Node({
    pkg: {
      name: 'peerdep',
      version: '1.2.3',
    },
    resolved: 'https://peer.com/peerdep.tgz',
    integrity: 'sha512-peerdeppeerdep',
    parent: peer,
  })

  const e = new Node({
    pkg: {
      name: 'e',
      version: '1.2.3',
      dependencies: {
        tgz: '',
        'tgz-pkg-resolved': '',
      },
      // expect to get "license": "blurb" in the metadata, not an object
      license: {
        type: 'blurb',
        url: 'http://example.com/',
      },
    },
    resolved: 'https://foo.com/e.tgz',
    parent: root,
  })

  const tgz = new Node({
    pkg: {
      name: 'tgz',
      version: '1.2.3',
      funding: { url: 'https://example.com/' },
      engines: {
        node: '>=10',
      },
      os: ['any', '!win32'],
      cpu: ['x64'],
    },
    resolved: '/home/user/projects/root/archives/tarball.tgz',
    parent: root,
  })
  const tgzPkgResolved = new Node({
    pkg: {
      name: 'tgz-pkg-resolved',
      version: '1.2.3',
      funding: { url: 'https://example.com/' },
      _resolved: '/home/user/projects/root/archives/tarball-pkg-resolved.tgz',
      _integrity: 'sha512-tarball/package/resolved/integrity',
    },
    parent: root,
  })

  const link = new Link({
    path: '/home/user/projects/root/node_modules/link',
    realpath: '/home/user/projects/root/target',
    parent: root,
    pkg: {
      name: 'link',
      version: '1.2.3',
      funding: 'https://example.com/payme',
      _resolved: 'github:isaacs/foobarbaz#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    target: new Node({
      realpath: '/home/user/projects/root/target',
      path: '/home/user/projects/root/target',
      root,
      pkg: {
        name: 'link',
        version: '1.2.3',
        funding: 'https://example.com/payme',
        _resolved: 'github:isaacs/foobarbaz#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    }),
  })

  const a = new Node({
    resolved: 'https://example.com/a.tgz',
    integrity: 'sha512-helloyesthisisdog',
    pkg: {
      name: 'a',
      version: '1.2.3',
    },
    parent: root,
  })

  const optin = new Node({
    pkg: {
      name: 'optin',
      version: '1.2.3',
      dependencies: { devo: '' },
    },
    parent: root,
  })

  const devit = new Node({
    pkg: {
      name: 'devit',
      version: '1.2.3',
      dependencies: { devo: '' },
    },
    parent: root,
  })

  const devo = new Node({
    pkg: {
      name: 'devo',
      version: '1.2.3',
    },
    parent: root,
  })

  const d = new Node({
    pkg: {
      name: 'd',
      version: '1.2.3',
      _shasum: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      bundleDependencies: ['bundled'],
      dependencies: {
        e: '1.2.3',
        bundled: 'npm:not-bundled-tho@*',
        'git-dep': 'github:foo/bar',
      },
    },
    parent: root,
  })
  const bundled = new Node({
    pkg: {
      name: 'not-bundled-tho',
      version: '1.2.3',
    },
    path: d.path + '/node_modules/bundled',
    name: 'bundled',
    parent: d,
  })
  const git = new Node({
    pkg: {
      name: 'git-dep',
      version: '1.2.3',
    },
    parent: d,
    resolved: 'git+ssh://git@github.com/foo/bar.git#0000000000000000000000000000000000000000',
  })

  const nopkg = new Node({
    path: root.path + '/node_modules/nopkg',
    parent: root,
  })

  calcDepFlags(root)

  t.matchSnapshot(meta.get(''), 'root metadata, no package version')
  root.package.version = '1.2.3'
  meta.add(root)
  t.matchSnapshot(meta.get(''), 'root metadata, with package version')

  t.matchSnapshot(meta.get(optin.location), 'meta for optional dep')
  t.matchSnapshot(meta.get(devit.location), 'meta for dev dep')
  t.matchSnapshot(meta.get(devo.location), 'meta for devOptional dep')

  t.matchSnapshot(meta.get(tgz.location), 'metadata for tarball file pkg')
  t.matchSnapshot(meta.get(tgzPkgResolved.location),
    'metadata for tarball file pkg with _resolved value')
  t.matchSnapshot(meta.get(link.path), 'link metadata')
  t.matchSnapshot(meta.get(link.target.path), 'link target metadata')
  t.matchSnapshot(meta.get(a.location), 'dep a metadata')
  t.matchSnapshot(meta.get(d.location), 'dep d metadata')
  t.matchSnapshot(meta.get(e.location), 'dep e metadata')
  t.matchSnapshot(meta.get(bundled.location), 'bundled pkg metadata')
  t.matchSnapshot(meta.get(git.location), 'git dep metadata')
  t.matchSnapshot(meta.get(nopkg.location), 'node without a package')
  t.matchSnapshot(meta.get(peer.location), 'a peer dep')
  t.matchSnapshot(meta.get(peerdep.location), 'a peer meta-dep')
  t.matchSnapshot(meta.commit(), 'data calculated from nodes themselves')
  t.end()
})

t.test('saving shrinkwrap object', t => {
  const dir = t.testdir({
    'package.json': JSON.stringify({
      name: 'badsave',
      version: '1.0.0',
      description: 'no node_modules/ will fail'
    })
  })

  t.test('save meta lockfile into node_modules directory', async t => {
    const sw = await Shrinkwrap.load({ path: dir, hiddenLockfile: true })
    t.equal(
      sw.filename,
      `${dir}/node_modules/.package-lock.json`,
      'correct filepath on shrinkwrap instance'
    )
    await sw.save()
    t.ok(sw, 'able to save with no deps')
    t.end()
  })

  t.test('save lockfile to root directory', async t => {
    const sw = await Shrinkwrap.load({ path: dir })
    t.equal(
      sw.filename,
      `${dir}/package-lock.json`,
      'correct filepath on shrinkwrap instance'
    )
    await sw.save()
    t.ok(sw, 'able to save with no deps')
    t.end()
  })

  t.end()
})

t.test('write the shrinkwrap back to disk', t => {
  const dir = t.testdir({})
  t.test('just read and write back', t =>
    Shrinkwrap.load({ path: fixture }).then(s => {
      s.filename = dir + '/test-shrinkwrap.json'
      return s.save().then(() =>
        t.strictSame(require(s.filename), s.data, 'saved json matches data'))
    }))
  t.test('write back with pending changes', t =>
    Shrinkwrap.load({ path: fixture }).then(s => {
      const dir = t.testdir({})
      s.filename = dir + '/test-shrinkwrap-with-changes.json'
      const node = new Node({
        path: fixture + '/node_modules/newthing',
        pkg: {
          name: 'newthing',
          version: '1.2.3',
        },
      })
      s.add(node)
      const preCommit = JSON.parse(JSON.stringify(s.data))
      const postCommit = s.commit()
      t.notSame(postCommit, preCommit, 'committing changes the data')
      // delete and re-add to put us back in the pre-commit state
      s.delete(node.location)
      s.add(node)
      return s.save().then(() => {
        const loc = relative(fixture, node.path).replace(/\\/g, '/')
        t.strictSame(s.data, postCommit, 'committed changes to data')
        t.strictSame(require(s.filename), s.data, 'saved json matches data')
      })
    }))
  t.end()
})

t.test('load shrinkwrap if no package-lock.json present', t => {
  const dir = t.testdir({
    'npm-shrinkwrap.json': JSON.stringify({
      lockfileVersion: 1,
      name: 'foo',
      version: '1.2.3',
    })
  })
  return Promise.all([
    Shrinkwrap.load({ path: dir, shrinkwrapOnly: true }).then(s =>
      t.equal(s.type, 'npm-shrinkwrap.json', 'loaded with swonly')),
    Shrinkwrap.load({ path: dir }).then(s =>
      t.equal(s.type, 'npm-shrinkwrap.json', 'loaded without swonly')),
  ])
})

t.test('load yarn.lock file if present', t =>
  Shrinkwrap.load({ path: yarnFixture }).then(s => {
    t.isa(s.yarnLock, YarnLock, 'loaded a yarn lock file')
    t.notEqual(s.yarnLock.entries.size, 0, 'got some entries')
  }))

t.test('save yarn lock if loaded', t =>
  Shrinkwrap.load({ path: yarnFixture }).then(s => {
    s.path = t.testdir()
    s.filename = s.path + '/package-lock.json'
    return s.save()
      .then(() => Shrinkwrap.load({ path: s.path }))
      .then(ss => t.strictSame(s.yarnLock, ss.yarnLock))
  }))

t.test('ignore yarn lock file parse errors', t => {
  const dir = t.testdir({
    'yarn.lock': 'this is not a yarn lock file!',
  })
  return Shrinkwrap.load({ path: dir }).then(s => {
    t.isa(s.yarnLock, YarnLock, 'got a yarn lock object because a yarn lock exists')
    t.equal(s.yarnLock.entries.size, 0, 'did not get any entries out of it')
  })
})

t.test('handle missing dependencies object without borking', t => {
  const s = new Shrinkwrap({ path: '/path/to/root' })
  s.data = {
    packages: {
      'node_modules/foo': {},
      'node_modules/foo/node_modules/bar': {},
    },
    dependencies: {
      foo: {
        resolved: 'http://foo.com',
        integrity: 'foo integrity',
        // no dependencies object here!
      },
    },
  }
  s.delete('/path/to/root/node_modules/foo/node_modules/bar')
  t.matchSnapshot(s.commit())
  t.end()
})

t.test('load a hidden lockfile', t => Shrinkwrap.load({
  path: hiddenLockfileFixture,
  hiddenLockfile: true,
}).then(s => {
  t.matchSnapshot(s.data)
  // make sure it does not add to the dependencies block when a new
  // node is added.
  s.data.dependencies = {}
  s.add(new Node({
    path: hiddenLockfileFixture + '/node_modules/foo',
    pkg: {
      name: 'foo',
      version: '1.2.3',
      _integrity: 'sha512-deadbeef',
      _resolved: 'https://registry.npmjs.org/foo/-/foo-1.2.3.tgz',
    },
  }))
  t.strictSame(s.data.dependencies, {}, 'did not add to legacy data')
  s.commit()
  t.equal(s.data.dependencies, undefined, 'deleted legacy metadata')
}))
