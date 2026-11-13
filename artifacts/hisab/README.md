# حساب | Hisab

Arabic-first, offline accounting for the browser and Tauri desktop. Transactions are saved on the device: IndexedDB in a browser and SQLite in the desktop app. No account or network connection is required for daily use.

## Run in a browser

From the workspace root:

```sh
pnpm install
pnpm --filter @workspace/hisab run dev
```

Open the local Vite address printed in the terminal. For a static web build:

```sh
pnpm --filter @workspace/hisab run build
```

## Run the desktop app in development

Install Rust 1.90 or later and the Tauri v2 system prerequisites for your operating system first. Run these commands from the workspace root:

```sh
cd artifacts/hisab
pnpm install
pnpm run desktop:dev
```

## Build the desktop installer

From the workspace root:

```sh
cd artifacts/hisab
pnpm install
pnpm run desktop:build
```

Tauri writes platform-specific bundles to `src-tauri/target/release/bundle/`. Build on each target operating system for its native installer; cross-compilation requires that platform's toolchain and signing setup.

## Accounting behavior

Amounts entered are before tax. Tax defaults to 0% until you configure a rate and is rounded to two decimal places before it is added to the transaction total. Income and expense transactions produce balanced double-entry journal lines; exports and printed receipts use the same stored totals. Set tax rates to match your local rules.

Browser and desktop data stores are separate and local to each installation. Export transactions as CSV to keep a portable copy of the ledger.

The web build caches its application shell and static assets after the first successful visit, so saved web records remain usable offline after that cache is installed.
