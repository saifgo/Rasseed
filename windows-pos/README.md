# Sarfli POS (Windows)

A small WinForms app for shop counters. The cashier uses the shop's Sarfli balance to send a plain credit recharge or a data package to a customer's phone, then follows the status of each sale. The server contract is in [API.md](API.md).

## Requirements

- **.NET Framework 4.5.2 or newer** on the shop PC. It is the oldest version this app supports, and the oldest that installs on **Windows 7 SP1**. Windows 8.1, 10 and 11 already include a compatible version.
  On Windows 7 SP1, install .NET Framework 4.5.2 (or 4.8) from Microsoft before you run the app.
- The app turns on TLS 1.2 itself (`ServicePointManager.SecurityProtocol`). On Windows 7 SP1 the PC also needs its normal Windows Updates, because SChannel must support TLS 1.2. If pairing fails with "Impossible de joindre le serveur" on an un-updated Windows 7 PC, install the updates first.

## Build

On a machine with the .NET SDK (5.0 or newer) and the .NET Framework 4.5.2 reference assemblies (installed with Visual Studio or the 4.5.2 Developer Pack):

```
cd windows-pos
dotnet build -c Release
```

Output: `windows-pos\bin\Release\net452\SarfliPOS.exe`, a single file of about 130 KB with no other DLLs. Copy that .exe to the shop PC. It needs no installer.

If the build cannot find the 4.5.2 reference assemblies, add the `Microsoft.NETFramework.ReferenceAssemblies` package to `SarfliPos.csproj` (build time only, nothing is added to the output).

## Pairing a terminal

1. On sarfli.com, the shop owner opens **Buy → POS terminals**, names the terminal and gets a **6-digit code**. The code is valid for 10 minutes.
2. On the PC, start `SarfliPOS.exe`, type the code and click **Associer**. The terminal name defaults to the Windows computer name.
3. The server URL is `https://sarfli.com` by default. To test against another server, click **Avancé** and enter e.g. `http://localhost:3100`. The app adds `/api/pos/v1` itself, and a full API URL also works.

When the server answers `401` (terminal revoked or access removed), the app clears the token and returns to the pairing screen. **Terminal → Dissocier ce terminal** does the same on demand. It only forgets the token on this PC, so revoke the terminal on sarfli.com as well if it should stop working for good.

## Where settings live

`%APPDATA%\Sarfli POS\config`, a small text file with:

- `apiBase`: the API base URL,
- `terminalName`: the name the server gave the terminal,
- `token`: the terminal token, encrypted with Windows DPAPI (`ProtectedData`, CurrentUser scope). Only the same Windows user on the same PC can decrypt it. If you copy the file to another user or PC, the app asks for a new pairing.

Delete the file to reset the app. A second file, `window`, remembers the corner the panel/button sits in and whether it stays on top.

## Using it

The app is made for touch screens and stays out of the way of the shop's own POS software:

- **Folded**, it is a 64×64 green **S** button in a corner, always on top. Tap it to open the panel. Press on it and slide to move it; the spot is remembered. A dot on the button tells what happened while it was folded: amber = a sale is still sending, green = done, red = failed, orange = to check.
- **Open**, it is a narrow 264×440 panel (no title bar) that grows out of that corner. **–** folds it again. Drag the title to move it. After a successful sale it folds back on its own.

A sale is four taps and a number:

1. **Operator**: tap the tile. It shows what can be spent now (for an admin terminal, Sarfli's own credit).
2. **Light or Internet**: **Light** sends credit (a plain recharge), **Internet** sends a data package. Both are always shown; one is greyed out when it is not set up for that operator (no recharge USSD, or no active package).
3. **Offer**: for Light, a credit amount (1, 2, 5, 10, 20 DT, or **Autre** to type whole dinars on the keypad). For Internet, the operator's data packages. Offers above the available credit are greyed out.
4. **Client number**: tap it on the keypad (⌫ erases one digit, C clears), then tap **Envoyer**.

**‹** goes back one step. Every target is at least 44 px tall. A physical keyboard still works: digits, Backspace, Enter, Esc, F5 (refresh) and F9 (history). The **⋯** menu (large rows) has History, Refresh, "Toujours au premier plan", Unpair and Quit. Quit asks for confirmation.

- **Retries**: each sent sale gets one `clientRef` (GUID). If the network fails or times out (20 s), the panel shows **Réessayer**, which resends the *same* request with the *same* `clientRef`, so the server never charges twice. **Abandonner** drops it. If the server did receive it, the sale still appears in the history.
- **History** (⋯ menu, F9, or tap the bottom bar): the 50 latest sales in a separate window with tall rows, coloured by status. A sale still queued (En attente) can be cancelled there; **Fermer** closes it.
- **Connection**: the bottom bar shows the terminal name and the time of the last successful contact, or "Hors connexion". The app keeps retrying on its own. The result of a sale that finishes later also shows there for 15 s.

## Code layout

| File | Role |
| --- | --- |
| `src/Program.cs` | Startup (TLS 1.2), pairing ↔ main screen loop |
| `src/PairForm.cs` | Pairing screen |
| `src/MainForm.cs` | Touch panel and folded button (operator → Light/Internet → offer → keypad → result), polling, window corner |
| `src/HistoryForm.cs` | History window, cancelling a queued sale |
| `src/Ui.cs` | Colours, tiles with press feedback and a keyboard focus ring |
| `src/ApiClient.cs` | HttpWebRequest client, 20 s timeouts, error mapping |
| `src/ApiModels.cs` | JSON contracts (DataContractJsonSerializer) |
| `src/PosConfig.cs` | Config file and DPAPI |
| `src/Format.cs` | Money, phone number and date formatting |
| `src/Strings.cs` | Every UI string (French). Add `UseArabic()` / `UseEnglish()` here later |

The app has no NuGet dependencies. Network calls run on the thread pool (`Task.Run` and `await`), so the UI never blocks.
