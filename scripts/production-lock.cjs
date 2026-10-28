function productionLockfile(source) {
  const root = source.importers['.'];
  const importer = {};
  for (const key of ['dependencies', 'optionalDependencies']) if (root[key]) importer[key] = root[key];
  const snapshots = {};
  const packages = {};
  function visit(name, value) {
    const version = typeof value === 'string' ? value : value.version;
    const key = `${name}@${version}`;
    if (Object.hasOwn(snapshots, key)) return;
    const snapshot = source.snapshots[key];
    if (!snapshot) throw new Error(`Missing locked production dependency: ${key}`);
    const packageKey = key.split('(')[0];
    if (!source.packages[packageKey]) throw new Error(`Missing package integrity: ${packageKey}`);
    snapshots[key] = snapshot;
    packages[packageKey] = source.packages[packageKey];
    for (const group of ['dependencies', 'optionalDependencies']) {
      for (const [dependency, reference] of Object.entries(snapshot[group] || {})) visit(dependency, reference);
    }
  }
  for (const group of ['dependencies', 'optionalDependencies']) {
    for (const [name, value] of Object.entries(importer[group] || {})) visit(name, value);
  }
  return { ...source, importers: { '.': importer }, packages, snapshots };
}
module.exports = { productionLockfile };
