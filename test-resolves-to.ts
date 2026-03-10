/**
 * Test: RESOLVES_TO — trace import symbols to their canonical declarations
 */
import { TypeScriptParser } from './src/core/parsers/typescript-parser.js';
import { CORE_TYPESCRIPT_SCHEMA } from './src/core/config/schema.js';
import { GRAMMY_FRAMEWORK_SCHEMA } from './src/core/config/grammy-framework-schema.js';
import { Project, Node } from 'ts-morph';

const GODSPEED_PATH = '/mnt/c/Users/ddfff/Downloads/Bots/GodSpeed/';

async function main() {
  // Create a ts-morph project directly to examine import resolution
  const project = new Project({
    compilerOptions: {
      allowJs: true,
      noEmit: true,
      moduleResolution: 100, // NodeNext
      module: 199, // NodeNext
      target: 99, // ESNext
    },
  });

  // Add GodSpeed source files (excluding src/src/)
  const sourceFiles = project.addSourceFilesAtPaths([
    `${GODSPEED_PATH}src/**/*.ts`,
    `!${GODSPEED_PATH}src/src/**`,
  ]);
  
  console.log(`Loaded ${sourceFiles.length} source files\n`);

  // Examine bot/index.ts imports
  const botIndex = sourceFiles.find(sf => sf.getFilePath().endsWith('bot/index.ts'));
  if (!botIndex) { console.log('bot/index.ts not found!'); return; }

  console.log('=== bot/index.ts imports ===\n');
  
  for (const importDecl of botIndex.getImportDeclarations()) {
    const moduleSpec = importDecl.getModuleSpecifierValue();
    const namedImports = importDecl.getNamedImports();
    const defaultImport = importDecl.getDefaultImport();
    const namespaceImport = importDecl.getNamespaceImport();
    
    console.log(`import from '${moduleSpec}':`);
    
    if (defaultImport) {
      console.log(`  default: ${defaultImport.getText()}`);
      // Try to resolve
      const symbol = defaultImport.getSymbol();
      if (symbol) {
        const decls = symbol.getDeclarations();
        for (const decl of decls) {
          console.log(`    → ${decl.getKindName()} @ ${decl.getSourceFile().getFilePath().split('/').slice(-3).join('/')} L${decl.getStartLineNumber()}`);
        }
      }
    }
    
    if (namespaceImport) {
      console.log(`  namespace: * as ${namespaceImport.getText()}`);
    }
    
    for (const named of namedImports.slice(0, 5)) {
      const name = named.getName();
      const alias = named.getAliasNode()?.getText();
      const isTypeOnly = named.isTypeOnly();
      
      console.log(`  ${isTypeOnly ? 'type ' : ''}${name}${alias ? ` as ${alias}` : ''}`);
      
      // Try to resolve to canonical declaration via aliased symbol
      const symbol = named.getSymbol();
      if (symbol) {
        const aliased = symbol.getAliasedSymbol?.() || symbol;
        const decls = aliased.getDeclarations();
        for (const decl of decls) {
          const sf = decl.getSourceFile();
          const kindName = decl.getKindName();
          const declName = (decl as any).getName?.() || '?';
          const isExternal = !sf.getFilePath().includes('/GodSpeed/src/');
          console.log(`    → ${kindName}(${declName}) @ ${sf.getFilePath().split('/').slice(-3).join('/')} L${decl.getStartLineNumber()}${isExternal ? ' [EXTERNAL]' : ''}`);
        }
      } else {
        console.log(`    → UNRESOLVED (no symbol)`);
      }
    }
    
    if (namedImports.length > 5) {
      console.log(`  ... and ${namedImports.length - 5} more`);
    }
    console.log();
  }

  // Summary: how many imports resolve vs don't
  let totalNamed = 0;
  let resolved = 0;
  let unresolved = 0;
  
  for (const sf of sourceFiles) {
    for (const importDecl of sf.getImportDeclarations()) {
      for (const named of importDecl.getNamedImports()) {
        totalNamed++;
        const symbol = named.getSymbol();
        if (symbol) {
          const aliased = symbol.getAliasedSymbol?.() || symbol;
          const decls = aliased.getDeclarations();
          // Check if resolution points to a project file (not self-reference or external)
          const selfFile = sf.getFilePath();
          const resolvedToOtherFile = decls.some(d => d.getSourceFile().getFilePath() !== selfFile);
          if (resolvedToOtherFile) {
            resolved++;
          } else {
            unresolved++;
          }
        } else {
          unresolved++;
        }
      }
    }
  }
  
  console.log('=== RESOLUTION SUMMARY ===');
  console.log(`Total named imports: ${totalNamed}`);
  console.log(`Resolved: ${resolved}`);
  console.log(`Unresolved: ${unresolved}`);
  console.log(`Resolution rate: ${((resolved / totalNamed) * 100).toFixed(1)}%`);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
