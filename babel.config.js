module.exports = {
  env: {
    test: {
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
        '@babel/preset-typescript',
      ],
      plugins: [
        // Vite replaces import.meta.env at build time.
        // In Jest (CJS), replace import.meta with an object so
        // import.meta.env.BASE_URL resolves to '/'.
        ({ types: t }) => ({
          visitor: {
            MetaProperty(path) {
              if (
                path.node.meta.name === 'import' &&
                path.node.property.name === 'meta'
              ) {
                path.replaceWith(
                  t.objectExpression([
                    t.objectProperty(
                      t.identifier('env'),
                      t.objectExpression([
                        t.objectProperty(
                          t.identifier('BASE_URL'),
                          t.stringLiteral('/')
                        ),
                      ])
                    ),
                    t.objectProperty(
                      t.identifier('url'),
                      t.stringLiteral('')
                    ),
                  ])
                );
              }
            },
          },
        }),
      ],
    },
  },
};
