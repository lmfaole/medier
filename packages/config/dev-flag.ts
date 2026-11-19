/**
 * Whether this module is being run by Vite's dev server rather than built:
 * `vite dev` loads an app's Worker through the module runner with
 * `import.meta.env` in scope, while a production build runs in workerd with
 * no `import.meta.env` at all and `node --test` has none either — so the
 * optional access keeps both of those on the strict production path.
 */
export const IS_DEV: boolean = import.meta.env?.DEV ?? false
