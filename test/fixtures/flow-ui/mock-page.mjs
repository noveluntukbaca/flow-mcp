// Deliberately minimal mock of the Playwright methods used by the compatibility layer.
// Counts/clicks operate on semantic fixture controls; never launch Chrome or invoke an API.
export function mockPage(fixture) {
  let currentUrl = fixture.url;
  let elements = structuredClone(fixture.elements);
  const clicks = [];
  class Locator {
    constructor(select) { this.select = select; }
    filter({ visible, hasText } = {}) { return new Locator(() => this.select().filter(e => (visible === undefined || (e.visible !== false) === visible) && (!hasText || hasText.test(e.name ?? '')))); }
    or(other) { return new Locator(() => [...new Set([...this.select(), ...other.select()])]); }
    getByRole(role, options) { return roleLocator(role, options, () => this.select().flatMap(e => e.children ?? [])); }
    locator() { return new Locator(() => this.select().flatMap(e => e.children ?? [])); }
    async evaluate() { return Boolean(this.select()[0]?.nativeForm); }
    async count() { return this.select().length; }
    async getAttribute(name) { const e = this.select()[0]; if (!e) throw Error('Missing element'); return e.attrs?.[name] ?? null; }
    async click() {
      const e = this.select()[0]; if (!e || e.disabled) throw Error('Not actionable'); clicks.push(e.id);
      if (e.action === 'toggle') { const key = 'aria-checked' in e.attrs ? 'aria-checked' : 'aria-pressed'; e.attrs[key] = e.attrs[key] === 'true' ? 'false' : 'true'; }
      if (e.action === 'characters') elements = [...elements.filter(e => !['new','heading','upload','asset'].includes(e.id)), ...structuredClone(fixture.characters ?? [])];
      if (e.action === 'creation') elements = [...elements.filter(e => e.id !== 'new'), ...structuredClone(fixture.creation ?? [])];
      if (e.action === 'redirect') currentUrl = 'https://accounts.google.com/signin';
    }
  }
  function roleLocator(role, { name } = {}, source = () => elements) {
    return new Locator(() => source().filter(e => e.role === role && (name === undefined || (name instanceof RegExp ? name.test(e.name ?? '') : name === e.name))));
  }
  return {
    url: () => currentUrl, clicks,
    getByRole: roleLocator,
    locator: selector => new Locator(() => elements.filter(e => e.selector === selector)),
    waitForTimeout: async () => {},
  };
}
