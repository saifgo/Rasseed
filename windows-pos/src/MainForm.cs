using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Linq;
using System.Media;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace SarfliPos
{
    /// <summary>
    /// Touch-first sale panel that floats over the shop's own POS software.
    /// Collapsed it is a 64×64 button; expanded a narrow 264×440 panel without a title bar.
    /// One sale = tap the operator, tap Light (credit) or Internet (data package), tap the offer, tap the client number, tap Send.
    /// A successful sale folds the panel back to the button. No animations: this runs all day.
    /// All network calls run on the thread pool (Task.Run) and come back to the UI thread through await.
    /// </summary>
    internal sealed class MainForm : Form
    {
        private const int HistoryLimit = 50;
        private const int PanelW = 264;
        private const int PanelH = 440;
        private const int BubbleSize = 64;
        private const int Gap = 6;
        private const int TouchH = 52;
        private static readonly long[] QuickAmounts = { 1000, 2000, 5000, 10000, 20000 };

        private enum Step { Operator, Kind, Offer, Number, Result }
        private enum SaleKind { Light, Internet }
        private enum Entry { Amount, Phone }

        /// <summary>What the client buys: a package, a fixed credit amount, or a credit amount typed on the keypad.</summary>
        private sealed class Offer
        {
            public Package Package;
            public long AmountMillimes; // credit; 0 = typed by the cashier
            public string Title { get { return Package != null ? Package.Name : Strings.ModeLight; } }
            public long Price { get { return Package != null ? Package.PriceMillimes : AmountMillimes; } }
        }

        private sealed class PendingSale
        {
            public CreateRechargeRequest Request;
            public string Summary;
        }

        private readonly PosConfig _config;
        private readonly ApiClient _api;

        // State
        private MeResponse _me;
        private bool _collapsed;
        private Step _step = Step.Operator;
        private Operator _op;
        private SaleKind _kind;
        private Offer _offer;
        private Entry _entry;
        private string _digits = "";        // client number being typed (digits only)
        private string _amountDigits = "";  // typed credit amount, whole DT
        private List<Recharge> _history = new List<Recharge>();
        private readonly Dictionary<string, string> _knownStatus = new Dictionary<string, string>();
        private readonly HashSet<string> _notified = new HashSet<string>();
        private PendingSale _pending;
        private string _resultId;
        private string _resultError;
        private string _bubbleMark;         // last finished sale shown on the collapsed button: ok | fail | review
        private bool _sending, _refreshing, _polling, _cancelling;
        private bool _closed, _forceClose;

        // Controls
        private readonly Panel _panel = new Panel();
        private readonly Panel _header = new Panel();
        private readonly Ui.CardButton _back = Ui.IconButton((g, r, c) => Ui.IconChevron(g, r, c, true, 2.2f), "Retour");
        private readonly Label _title = new Ui.OneLineLabel();
        private readonly Ui.CardButton _collapse = Ui.IconButton(Ui.IconMinus, "Réduire");
        private readonly StepDots _progress = new StepDots();
        private readonly Panel _body = new Panel();
        private readonly Panel _bar = new Panel();
        private readonly BarLabel _barText = new BarLabel();
        private readonly Ui.CardButton _more = Ui.IconButton(Ui.IconDots, "Menu");
        private readonly BubbleButton _bubble = new BubbleButton();
        private readonly ContextMenuStrip _menu = new ContextMenuStrip();
        private ToolStripMenuItem _miOnTop;
        private readonly Timer _pollTimer = new Timer { Interval = 4000 };
        private readonly Timer _refreshTimer = new Timer { Interval = 60000 };
        private readonly Timer _barTimer = new Timer { Interval = 15000 };
        private readonly Timer _autoCollapse = new Timer { Interval = 3500 };
        private HistoryForm _historyForm;
        private string _barStatus = "";
        private bool _barError;
        private bool _barShowsResult;

        // Number step widgets
        private DisplayCard _display;
        private Button _send;

        /// <summary>True when the form closed because the terminal was unpaired or revoked.</summary>
        public bool BackToPairing { get; private set; }

        public MainForm(PosConfig config)
        {
            _config = config;
            _api = new ApiClient(config.ApiBase, config.Token);

            Text = Strings.AppTitle;
            Icon = Ui.AppIcon;
            Font = Ui.F(10f);
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = true;
            BackColor = Ui.Line; // 1px frame around the panel
            KeyPreview = true;
            TopMost = WindowPrefs.OnTop;
            StartPosition = FormStartPosition.Manual;
            DoubleBuffered = true;

            BuildPanel();
            BuildBubble();
            SetExpanded(true, true);
            ShowStep(Step.Operator);

            _pollTimer.Tick += OnPollTick;
            _refreshTimer.Tick += async (s, e) => await RefreshAllAsync();
            _barTimer.Tick += (s, e) => ClearBarResult();
            _autoCollapse.Tick += (s, e) =>
            {
                _autoCollapse.Stop();
                if (!_collapsed && _step == Step.Result && _pending == null && !_sending)
                {
                    StartNewSale();
                    SetExpanded(false, false);
                }
            };
            Shown += async (s, e) =>
            {
                _pollTimer.Start();
                _refreshTimer.Start();
                await RefreshAllAsync();
            };
            FormClosing += OnFormClosing;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Ui.RoundCorners(Handle); // Windows 11 only; a no-op on 7/8/10
        }

        /// <summary>A soft drop shadow (drawn by Windows) separates the borderless panel from the POS under it.</summary>
        protected override CreateParams CreateParams
        {
            get
            {
                const int CS_DROPSHADOW = 0x20000;
                CreateParams cp = base.CreateParams;
                cp.ClassStyle |= CS_DROPSHADOW;
                return cp;
            }
        }

        // ------------------------------------------------------------------ window: panel <-> button

        /// <summary>
        /// Switches size while keeping the bottom-right corner in place, so the panel opens out of the button
        /// the cashier just tapped and folds back into it.
        /// </summary>
        private void SetExpanded(bool expanded, bool initial)
        {
            Point corner = initial ? WindowPrefs.Corner(new Size(PanelW + 2, PanelH + 2)) : new Point(Right, Bottom);
            _collapsed = !expanded;
            SuspendLayout();
            _panel.Visible = expanded;
            _bubble.Visible = !expanded;
            Size size = expanded ? new Size(PanelW + 2, PanelH + 2) : new Size(BubbleSize, BubbleSize);
            Padding = expanded ? new Padding(1) : Padding.Empty;
            var bounds = new Rectangle(corner.X - size.Width, corner.Y - size.Height, size.Width, size.Height);
            // Opening near a screen edge: slide the panel back fully onto the screen.
            Rectangle area = Screen.FromPoint(corner).WorkingArea;
            bounds.X = Math.Max(area.Left, Math.Min(bounds.X, area.Right - bounds.Width));
            bounds.Y = Math.Max(area.Top, Math.Min(bounds.Y, area.Bottom - bounds.Height));
            Bounds = bounds;
            Region = expanded ? null : RoundRegion(size, 16);
            ResumeLayout();
            if (!initial) WindowPrefs.SaveCorner(new Point(Right, Bottom));
            if (expanded) { _autoCollapse.Stop(); FocusStep(); }
            _bubble.Invalidate();
        }

        private static Region RoundRegion(Size s, int radius)
        {
            using (GraphicsPath path = RoundRect(new Rectangle(0, 0, s.Width, s.Height), radius)) return new Region(path);
        }

        private static GraphicsPath RoundRect(Rectangle r, int radius)
        {
            var p = new GraphicsPath();
            int d = radius * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        [DllImport("user32.dll")] private static extern bool ReleaseCapture();
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);

        /// <summary>Hands the move to Windows (works with mouse and finger) from any drag surface.</summary>
        private void BeginWindowDrag()
        {
            const int WM_NCLBUTTONDOWN = 0xA1, HTCAPTION = 2;
            ReleaseCapture();
            SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
            WindowPrefs.SaveCorner(new Point(Right, Bottom));
        }

        private void BuildBubble()
        {
            _bubble.Dock = DockStyle.Fill;
            _bubble.Visible = false;
            _bubble.Mark = () => _sending || _history.Any(h => h.IsLive) ? "live" : _bubbleMark;
            // Tap opens; press and move drags the button somewhere else.
            Point down = Point.Empty;
            bool pressed = false;
            _bubble.MouseDown += (s, e) => { if (e.Button == MouseButtons.Left) { down = e.Location; pressed = true; } };
            _bubble.MouseMove += (s, e) =>
            {
                if (!pressed) return;
                if (Math.Abs(e.X - down.X) > 6 || Math.Abs(e.Y - down.Y) > 6) { pressed = false; BeginWindowDrag(); }
            };
            _bubble.MouseUp += (s, e) =>
            {
                if (!pressed) return;
                pressed = false;
                _bubbleMark = null;
                SetExpanded(true, false);
            };
            Controls.Add(_bubble);
        }

        private void BuildPanel()
        {
            _panel.Dock = DockStyle.Fill;
            _panel.BackColor = Ui.Background;

            // Header: back · title (drag handle) · fold, then the step dots
            _header.Dock = DockStyle.Top;
            _header.Height = 50;
            _header.BackColor = Ui.Surface;
            _header.Padding = new Padding(4, 3, 4, 3);
            _back.Dock = DockStyle.Left;
            _back.Click += (s, e) => GoBack();
            _collapse.Dock = DockStyle.Right;
            _collapse.Click += (s, e) => SetExpanded(false, false);
            _title.Dock = DockStyle.Fill;
            _title.TextAlign = ContentAlignment.MiddleLeft;
            _title.Font = Ui.Semi(12f);
            _title.ForeColor = Ui.Text;
            _title.AutoEllipsis = true;
            _title.Padding = new Padding(8, 0, 0, 0);
            _title.MouseDown += (s, e) => { if (e.Button == MouseButtons.Left) BeginWindowDrag(); };
            _header.MouseDown += (s, e) => { if (e.Button == MouseButtons.Left) BeginWindowDrag(); };
            _header.Controls.Add(_title);
            _header.Controls.Add(_back);
            _header.Controls.Add(_collapse);
            _progress.Dock = DockStyle.Top;
            _progress.MouseDown += (s, e) => { if (e.Button == MouseButtons.Left) BeginWindowDrag(); };
            var headerLine = new Panel { Dock = DockStyle.Top, Height = 1, BackColor = Ui.Line };

            _body.Dock = DockStyle.Fill;
            _body.Padding = new Padding(10, 8, 10, 8);

            // Bottom bar: connection, or the result of the last finished sale; ⋯ menu
            _bar.Dock = DockStyle.Bottom;
            _bar.Height = 40;
            _bar.BackColor = Ui.Surface;
            _bar.Padding = new Padding(0, 2, 4, 2);
            _barText.Dock = DockStyle.Fill;
            _barText.Click += (s, e) => ShowHistory();
            _more.Dock = DockStyle.Right;
            _more.Click += (s, e) => _menu.Show(_more, new Point(_more.Width, 0), ToolStripDropDownDirection.AboveLeft);
            _bar.Controls.Add(_barText);
            _bar.Controls.Add(_more);
            var barLine = new Panel { Dock = DockStyle.Bottom, Height = 1, BackColor = Ui.Line };

            // Menu: tall rows for fingers
            _menu.Font = Ui.F(12f);
            _menu.Renderer = new Ui.MenuRenderer();
            _menu.ShowImageMargin = false;
            _menu.ShowCheckMargin = true;
            AddMenuItem(Strings.HistoryTitle, (s, e) => ShowHistory());
            AddMenuItem(Strings.MenuRefresh.Replace("&", ""), async (s, e) => await RefreshAllAsync());
            _miOnTop = AddMenuItem(Strings.MenuOnTop, (s, e) => ToggleOnTop());
            _miOnTop.Checked = TopMost;
            _menu.Items.Add(new ToolStripSeparator());
            AddMenuItem(Strings.MenuUnpair.Replace("&", ""), (s, e) => Unpair());
            AddMenuItem(Strings.MenuQuit.Replace("&", ""), (s, e) => ConfirmQuit());

            _panel.Controls.Add(_body);
            _panel.Controls.Add(headerLine);
            _panel.Controls.Add(_progress);
            _panel.Controls.Add(_header);
            _panel.Controls.Add(barLine);
            _panel.Controls.Add(_bar);
            Controls.Add(_panel);
            SetBarStatus(Strings.Loading, false);
        }

        private ToolStripMenuItem AddMenuItem(string text, EventHandler onClick)
        {
            var item = new ToolStripMenuItem(text, null, onClick) { Padding = new Padding(8, 10, 8, 10) };
            _menu.Items.Add(item);
            return item;
        }

        /// <summary>On a touch screen "Quitter" is one finger away from the other items: ask first.</summary>
        private void ConfirmQuit()
        {
            if (_pending != null || _sending) { Close(); return; } // FormClosing asks its own question
            if (MessageBox.Show(this, Strings.QuitConfirm, Strings.AppTitle, MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2) == DialogResult.Yes)
                Close();
        }

        private void ToggleOnTop()
        {
            TopMost = !TopMost;
            _miOnTop.Checked = TopMost;
            WindowPrefs.OnTop = TopMost;
        }

        // ------------------------------------------------------------------ steps

        private void ShowStep(Step step)
        {
            _step = step;
            _body.SuspendLayout();
            foreach (Control c in _body.Controls.Cast<Control>().ToList()) c.Dispose();
            _body.Controls.Clear();
            _display = null; _send = null;

            switch (step)
            {
                case Step.Operator: BuildOperatorStep(); break;
                case Step.Kind: BuildKindStep(); break;
                case Step.Offer: BuildOfferStep(); break;
                case Step.Number: BuildNumberStep(); break;
                case Step.Result: BuildResultStep(); break;
            }
            _back.Visible = step == Step.Kind || step == Step.Offer || step == Step.Number;
            _progress.Done = step == Step.Result ? 4 : (int)step + 1;
            _title.Padding = new Padding(_back.Visible ? 0 : 10, 0, 0, 0);
            _body.ResumeLayout();
            FocusStep();
        }

        /// <summary>
        /// Keeps a real keyboard target: when the focused control is destroyed with the old step, Windows would
        /// send keys as system keys and a physical keyboard would stop working.
        /// </summary>
        private void FocusStep()
        {
            if (_collapsed) return;
            Button first = AllButtons(_body).FirstOrDefault(b => b.Enabled && b.Visible);
            if (first != null) first.Focus(); else _collapse.Focus();
        }

        private bool TypedOffer { get { return _offer != null && _offer.Package == null && _offer.AmountMillimes == 0; } }

        private void GoBack()
        {
            if (_step == Step.Number && TypedOffer && _entry == Entry.Phone)
            {
                _entry = Entry.Amount; // typed amount: go back to the amount first
                ShowStep(Step.Number);
            }
            else if (_step == Step.Number) ShowStep(Step.Offer);
            else if (_step == Step.Offer) ShowStep(Step.Kind);
            else if (_step == Step.Kind) ShowStep(Step.Operator);
        }

        private void StartNewSale()
        {
            if (_pending != null || _sending) return;
            _autoCollapse.Stop();
            _resultId = null;
            _resultError = null;
            _op = null;
            _offer = null;
            ShowStep(Step.Operator);
        }

        private static int ContentWidth { get { return PanelW - 16; } }

        // Step 1: operator ------------------------------------------------------

        private void BuildOperatorStep()
        {
            _title.Text = Strings.StepOperator;
            if (_me == null)
            {
                _body.Controls.Add(CenterNote(Strings.Loading));
                return;
            }
            var list = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true };
            foreach (Operator op in _me.Operators)
            {
                Operator current = op;
                bool sellable = Offers(op).Count > 0;
                Color color = Format.ParseColor(op.Color, Color.DimGray);
                // Balances are never shown: only what can be sold.
                string hint = !sellable ? Strings.NothingToSell : DailyLeft() <= 0 ? Strings.DailyLimitReached : KindsHint(op);
                Button tile = OperatorTile(op.Name, hint, color, ContentWidth - 4, 66);
                tile.Margin = new Padding(0, 0, 0, Gap + 2);
                tile.Enabled = sellable;
                tile.Click += (s, e) => PickOperator(current);
                list.Controls.Add(tile);
            }
            if (_me.Operators.Count == 0) _body.Controls.Add(CenterNote(Strings.NothingToSell));
            else _body.Controls.Add(list);
        }

        private void PickOperator(Operator op)
        {
            if (_pending != null || _sending) return;
            _op = op;
            _offer = null;
            ShowStep(Step.Kind);
        }

        // Step 2: Light (credit recharge) or Internet (data package) -------------

        private bool LightAvailable(Operator op) { return op != null && op.RechargeEnabled; }

        private string KindsHint(Operator op)
        {
            var kinds = new List<string>();
            if (LightAvailable(op)) kinds.Add(Strings.ModeLight);
            if (PackageCount(op) > 0) kinds.Add(Strings.ModeInternet);
            return string.Join(" · ", kinds);
        }

        // Spending limits ---------------------------------------------------------
        // The server checks them again on every sale; here they only grey out what would be refused.

        /// <summary>What this PC may still spend today (owner's daily limit), or long.MaxValue without a limit.</summary>
        private long DailyLeft()
        {
            if (_me == null || _me.Terminal == null || _me.Terminal.DailyLimitMillimes == null) return long.MaxValue;
            return Math.Max(0, _me.Terminal.DailyLimitMillimes.Value - _me.Terminal.SpentTodayMillimes);
        }

        /// <summary>Largest Light recharge allowed now: credit, admin cap per recharge and daily limit.</summary>
        private long LightMax(Operator op)
        {
            long max = Math.Min(op.BalanceMillimes, DailyLeft());
            if (op.MaxRechargeMillimes != null && op.MaxRechargeMillimes.Value > 0) max = Math.Min(max, op.MaxRechargeMillimes.Value);
            return max;
        }

        /// <summary>Why this amount cannot be sold, or null when it can.</summary>
        private string BlockReason(Operator op, long amount, bool light)
        {
            if (light && op.MaxRechargeMillimes != null && op.MaxRechargeMillimes.Value > 0 && amount > op.MaxRechargeMillimes.Value)
                return string.Format(Strings.MaxPerRecharge, Format.Money(op.MaxRechargeMillimes.Value));
            if (amount > DailyLeft()) return DailyLeft() <= 0 ? Strings.DailyLimitReached : Strings.OverDailyLimit;
            if (amount > op.BalanceMillimes) return Strings.NotEnough;
            return null;
        }

        private int PackageCount(Operator op)
        {
            return _me == null || op == null ? 0 : _me.Packages.Count(p => p.OperatorCode == op.Code);
        }

        private void BuildKindStep()
        {
            _title.Text = _op.Name;
            Color color = Format.ParseColor(_op.Color, Color.DimGray);
            var list = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false };

            bool light = LightAvailable(_op);
            Button lightTile = KindTile(Strings.ModeLight, light ? Strings.LightHint : Strings.KindUnavailable, color, Ui.IconBolt, ContentWidth - 4, 88);
            lightTile.Margin = new Padding(0, 0, 0, Gap + 2);
            lightTile.Enabled = light;
            lightTile.Click += (s, e) => PickKind(SaleKind.Light);
            list.Controls.Add(lightTile);

            int packages = PackageCount(_op);
            Button netTile = KindTile(Strings.ModeInternet, packages > 0 ? string.Format(Strings.InternetHint, packages) : Strings.NoPackages, color, Ui.IconSignal, ContentWidth - 4, 88);
            netTile.Margin = new Padding(0, 0, 0, Gap + 2);
            netTile.Enabled = packages > 0;
            netTile.Click += (s, e) => PickKind(SaleKind.Internet);
            list.Controls.Add(netTile);

            _body.Controls.Add(list);
        }

        private void PickKind(SaleKind kind)
        {
            if (_pending != null || _sending) return;
            _kind = kind;
            _offer = null;
            ShowStep(Step.Offer);
        }

        // Step 3: offer -----------------------------------------------------------

        private List<Offer> Offers(Operator op)
        {
            var offers = new List<Offer>();
            if (_me == null || op == null) return offers;
            offers.AddRange(_me.Packages.Where(p => p.OperatorCode == op.Code).Select(p => new Offer { Package = p }));
            if (op.RechargeEnabled)
                offers.AddRange(QuickAmounts.Select(a => new Offer { AmountMillimes = a }).Concat(new[] { new Offer() }));
            return offers;
        }

        private void BuildOfferStep()
        {
            _title.Text = _op.Name + " · " + (_kind == SaleKind.Light ? Strings.ModeLight : Strings.ModeInternet);
            Color color = Format.ParseColor(_op.Color, Color.DimGray);
            List<Offer> offers = Offers(_op);
            List<Offer> packages = _kind == SaleKind.Internet ? offers.Where(o => o.Package != null).ToList() : new List<Offer>();
            List<Offer> credit = _kind == SaleKind.Light ? offers.Where(o => o.Package == null).ToList() : new List<Offer>();
            if (packages.Count == 0 && credit.Count == 0)
            {
                _body.Controls.Add(CenterNote(_kind == SaleKind.Light ? Strings.KindUnavailable : Strings.NoPackages));
                return;
            }

            var list = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = true, AutoScroll = true };
            // Leave room for a scrollbar only when the list is long enough to scroll.
            int height = packages.Count * (TouchH + 8 + Gap) + ((credit.Count + 2) / 3) * (TouchH + Gap);
            int full = ContentWidth - 4 - (height > PanelH - 100 ? SystemInformation.VerticalScrollBarWidth + 2 : 0);

            if (packages.Count > 0)
            {
                foreach (Offer o in packages)
                {
                    Offer current = o;
                    string blocked = BlockReason(_op, o.Price, false);
                    bool affordable = blocked == null;
                    Button tile = PriceTile(o.Title, affordable ? Format.Money(o.Price) : blocked, full, TouchH + 8);
                    tile.Margin = new Padding(0, 0, 0, Gap);
                    tile.Enabled = affordable;
                    tile.Click += (s, e) => PickOffer(current);
                    list.Controls.Add(tile);
                }
            }
            if (credit.Count > 0)
            {
                int w = (full - 2 * Gap) / 3;
                int i = 0;
                foreach (Offer o in credit)
                {
                    Offer current = o;
                    bool typed = o.AmountMillimes == 0;
                    string label = typed ? Strings.OtherAmountShort : (o.AmountMillimes / 1000) + " DT";
                    Button tile = AmountTile(label, typed, w, TouchH + 4);
                    tile.Margin = new Padding(0, 0, (i % 3 == 2) ? 0 : Gap, Gap);
                    // "Autre" needs room for at least 1 DT.
                    tile.Enabled = typed ? LightMax(_op) >= 1000 : o.AmountMillimes <= LightMax(_op);
                    tile.Click += (s, e) => PickOffer(current);
                    list.Controls.Add(tile);
                    i++;
                }
            }
            _body.Controls.Add(list);
        }

        private void PickOffer(Offer offer)
        {
            if (_pending != null || _sending) return;
            _offer = offer;
            _digits = "";
            _amountDigits = "";
            _entry = TypedOffer ? Entry.Amount : Entry.Phone;
            ShowStep(Step.Number);
        }

        // Step 4: keypad ----------------------------------------------------------

        private void BuildNumberStep()
        {
            // Display: what is being typed, big; one line of context under it.
            _display = new DisplayCard { Dock = DockStyle.Top, Height = 64 };

            // Keypad 3×4: 1-9, ⌫ 0 C
            var pad = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 4, Margin = Padding.Empty };
            for (int c = 0; c < 3; c++) pad.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.33f));
            for (int r = 0; r < 4; r++) pad.RowStyles.Add(new RowStyle(SizeType.Percent, 25f));
            string[] keys = { "1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "C" };
            for (int i = 0; i < keys.Length; i++)
            {
                string k = keys[i];
                bool digit = char.IsDigit(k[0]);
                var key = new Ui.CardButton
                {
                    Fill = digit ? Ui.Surface : Ui.Mix(Ui.Surface, Ui.Background, 0.5),
                    Border = Ui.Line,
                    Radius = 12f,
                    Font = digit ? Ui.Semi(17f) : Ui.Semi(13f),
                    ForeColor = digit ? Ui.Text : Ui.Muted,
                    Text = k == "⌫" ? "" : k,
                    AccessibleName = k == "⌫" ? "Effacer" : k == "C" ? "Tout effacer" : k,
                    Dock = DockStyle.Fill,
                };
                if (k == "⌫") key.Content = (g, r, self) => Ui.IconBackspace(g, r, Ui.Muted);
                int col = i % 3, row = i / 3;
                key.Margin = new Padding(col == 0 ? 0 : Gap / 2, row == 0 ? 0 : Gap / 2, col == 2 ? 0 : Gap / 2, row == 3 ? 0 : Gap / 2);
                key.Click += (s, e) => PressKey(k);
                pad.Controls.Add(key, col, row);
            }

            _send = Ui.Primary(Strings.Send);
            _send.Dock = DockStyle.Bottom;
            _send.Height = TouchH + 2;
            _send.Click += (s, e) => OnSendOrNext();

            // Docking order: last added docks first.
            _body.Controls.Add(pad);
            _body.Controls.Add(new Panel { Dock = DockStyle.Top, Height = Gap });
            _body.Controls.Add(_display);
            _body.Controls.Add(new Panel { Dock = DockStyle.Bottom, Height = Gap });
            _body.Controls.Add(_send);
            RefreshEntry();
        }

        private void PressKey(string k)
        {
            if (_step != Step.Number || _pending != null || _sending) return;
            bool amount = _entry == Entry.Amount;
            string value = amount ? _amountDigits : _digits;
            if (k == "⌫") value = value.Length > 0 ? value.Substring(0, value.Length - 1) : value;
            else if (k == "C") value = "";
            else if (amount ? (value.Length < 3 && !(value.Length == 0 && k == "0")) : value.Length < 8) value += k;
            if (amount) _amountDigits = value; else _digits = value;
            RefreshEntry();
        }

        private long TypedAmountMillimes()
        {
            int dt;
            return int.TryParse(_amountDigits, out dt) && dt > 0 ? dt * 1000L : -1;
        }

        private long CurrentAmount()
        {
            if (_offer == null) return -1;
            return TypedOffer ? TypedAmountMillimes() : _offer.Price;
        }

        private void RefreshEntry()
        {
            if (_display == null) return;
            if (_entry == Entry.Amount)
            {
                long amount = TypedAmountMillimes();
                string blocked = amount > 0 ? BlockReason(_op, amount, true) : null;
                bool over = blocked != null;
                _title.Text = Strings.ModeLight;
                _display.Set((_amountDigits.Length == 0 ? "0" : _amountDigits) + " DT", _amountDigits.Length == 0 ? Ui.Faint : Ui.Text,
                    over ? blocked : Strings.Amount, over ? Ui.Danger : Ui.Muted);
                SetSend(amount > 0 && !over, Strings.Next);
                return;
            }
            long price = CurrentAmount();
            _title.Text = _offer.Package != null ? _offer.Package.Name : Strings.ModeLight;
            string shown = _digits.PadRight(8, '·');
            _display.Set(shown.Substring(0, 2) + " " + shown.Substring(2, 3) + " " + shown.Substring(5, 3), _digits.Length == 0 ? Ui.Faint : Ui.Text,
                Strings.Phone + " · " + Format.Money(price), Ui.Muted);
            bool complete = _digits.Length == 8;
            SetSend(complete && !_sending && _pending == null, complete ? Strings.Send : Strings.EnterNumberShort);
        }

        private void SetSend(bool enabled, string text)
        {
            _send.Enabled = enabled;
            _send.Text = text;
            _send.Invalidate();
        }

        private void OnSendOrNext()
        {
            if (_entry == Entry.Amount)
            {
                if (TypedAmountMillimes() <= 0 || TypedAmountMillimes() > LightMax(_op)) return;
                _entry = Entry.Phone;
                RefreshEntry();
                return;
            }
            TrySend();
        }

        private async void TrySend()
        {
            if (_step != Step.Number || _pending != null || _sending || _digits.Length != 8) return;
            string msisdn = Format.NormalizeMsisdn(_digits);
            long amount = CurrentAmount();
            if (msisdn == null || amount <= 0) return;

            var request = new CreateRechargeRequest { Msisdn = msisdn, ClientRef = Guid.NewGuid().ToString() };
            if (_offer.Package != null) request.PackageId = _offer.Package.Id;
            else { request.OperatorCode = _op.Code; request.AmountMillimes = amount; }

            // From here this sale has exactly one clientRef, kept for every retry.
            string what = _offer.Package != null ? _offer.Package.Name : Format.Money(amount);
            _pending = new PendingSale { Request = request, Summary = what + "\n" + Format.Msisdn(msisdn) };
            _resultId = null;
            _resultError = null;
            await SubmitPendingAsync();
        }

        // Step 5: result ----------------------------------------------------------

        private void BuildResultStep()
        {
            Recharge r = _resultId != null ? _history.FirstOrDefault(x => x.Id == _resultId) : null;
            string head, detail;
            Color tone;
            ResultView.Glyph glyph;

            if (_sending) { head = Strings.Sending; detail = _pending != null ? _pending.Summary : ""; tone = Ui.Accent; glyph = ResultView.Glyph.Wait; }
            else if (_pending != null) { head = Strings.NoAnswer; detail = _pending.Summary + "\n\n" + Strings.PendingSafeRetry; tone = Ui.Danger; glyph = ResultView.Glyph.Bang; }
            else if (_resultError != null) { head = Strings.Refused; detail = _resultError; tone = Ui.Danger; glyph = ResultView.Glyph.Cross; }
            else if (r == null) { head = ""; detail = ""; tone = Ui.Text; glyph = ResultView.Glyph.None; }
            else
            {
                detail = HistoryForm.Describe(r) + "\n" + Format.Msisdn(r.Msisdn);
                switch (r.Status)
                {
                    case "succeeded": head = Strings.StatusSucceeded; tone = Ui.Accent; glyph = ResultView.Glyph.Check; break;
                    case "failed": head = Strings.StatusFailed; tone = Ui.Danger; glyph = ResultView.Glyph.Cross; detail += "\n\n" + (r.FailReason == "number_not_compatible" ? Strings.FailedNotCompatible : Strings.FailedRefunded); break;
                    case "cancelled": head = Strings.StatusCancelled; tone = Ui.Muted; glyph = ResultView.Glyph.Cross; break;
                    case "review": head = Strings.StatusReview; tone = Ui.Warning; glyph = ResultView.Glyph.Bang; detail += "\n\n" + Strings.ReviewExplain; break;
                    default: head = Strings.StatusSending + "…"; tone = Ui.Accent; glyph = ResultView.Glyph.Wait; detail += "\n\n" + Strings.LiveExplainShort; break;
                }
            }
            _title.Text = _op != null ? _op.Name : Strings.AppTitle;

            var view = new ResultView { Dock = DockStyle.Fill, Head = head, Detail = detail, Tone = tone, Icon = glyph };

            if (_pending != null && !_sending)
            {
                Button retry = Ui.Primary(Strings.Retry);
                retry.Dock = DockStyle.Bottom;
                retry.Height = TouchH + 2;
                retry.Click += async (s, e) => await SubmitPendingAsync();
                Button abandon = Ui.Secondary(Strings.Abandon);
                abandon.Dock = DockStyle.Bottom;
                abandon.Height = TouchH - 4;
                abandon.Click += (s, e) => AbandonPending();
                _body.Controls.Add(view);
                _body.Controls.Add(retry);
                _body.Controls.Add(new Panel { Dock = DockStyle.Bottom, Height = Gap });
                _body.Controls.Add(abandon);
            }
            else
            {
                Button next = Ui.Primary(Strings.NewSaleShort);
                next.Dock = DockStyle.Bottom;
                next.Height = TouchH + 2;
                next.Enabled = !_sending;
                next.Click += (s, e) => StartNewSale();
                _body.Controls.Add(view);
                _body.Controls.Add(next);
            }

            // A clean success folds the panel back into the button, so the POS underneath is free again.
            _autoCollapse.Stop();
            if (r != null && r.Status == "succeeded" && _pending == null && !_sending) _autoCollapse.Start();
        }

        // ------------------------------------------------------------------ building blocks

        /// <summary>Operator choice: logo-like badge in the operator colour, name, what can be spent, chevron.</summary>
        private static Button OperatorTile(string name, string subtitle, Color color, int width, int height)
        {
            Ui.CardButton b = Ui.Card();
            b.Size = new Size(width, height);
            b.AccessibleName = name + ", " + subtitle;
            b.Content = (g, r, self) =>
            {
                bool on = self.Enabled;
                var badge = new Rectangle(r.X + 12, r.Y + (r.Height - 40) / 2, 40, 40);
                Ui.FillRound(g, badge, 11f, on ? color : Ui.Line, Color.Empty);
                Ui.DrawText(g, Initials(name), Ui.Semi(11.5f), badge, on ? Color.White : Ui.Muted, Ui.Centered);
                int x = badge.Right + 12, w = r.Right - x - 30;
                Ui.DrawText(g, name, Ui.Semi(12.5f), new Rectangle(x, r.Y + r.Height / 2 - 21, w, 22), on ? Ui.Text : Ui.Muted, Ui.OneLine);
                Ui.DrawText(g, subtitle, Ui.F(10f), new Rectangle(x, r.Y + r.Height / 2 + 1, w, 20), on ? Ui.Muted : Ui.Faint, Ui.OneLine);
                if (on) Ui.IconChevron(g, new RectangleF(r.Right - 30, r.Y + (r.Height - 20) / 2f, 20, 20), Ui.Faint, false, 1.8f);
            };
            return b;
        }

        /// <summary>Light / Internet: icon in a soft circle of the operator colour, title, hint, chevron.</summary>
        private static Button KindTile(string title, string subtitle, Color color, Action<Graphics, RectangleF, Color> icon, int width, int height)
        {
            Ui.CardButton b = Ui.Card();
            b.Size = new Size(width, height);
            b.AccessibleName = title + ", " + subtitle;
            b.Content = (g, r, self) =>
            {
                bool on = self.Enabled;
                var circle = new Rectangle(r.X + 14, r.Y + (r.Height - 48) / 2, 48, 48);
                Ui.FillRound(g, circle, 24f, on ? Ui.Mix(color, Color.White, 0.86) : Ui.Background, Color.Empty);
                icon(g, new RectangleF(circle.X + 10, circle.Y + 10, 28, 28), on ? color : Ui.Faint);
                int x = circle.Right + 14, w = r.Right - x - 30;
                Ui.DrawText(g, title, Ui.Semi(14f), new Rectangle(x, r.Y + r.Height / 2 - 24, w, 26), on ? Ui.Text : Ui.Muted, Ui.OneLine);
                Ui.DrawText(g, subtitle, Ui.F(10f), new Rectangle(x, r.Y + r.Height / 2 + 2, w, 20), on ? Ui.Muted : Ui.Faint, Ui.OneLine);
                if (on) Ui.IconChevron(g, new RectangleF(r.Right - 30, r.Y + (r.Height - 20) / 2f, 20, 20), Ui.Faint, false, 1.8f);
            };
            return b;
        }

        /// <summary>Package row: name (up to two lines) on the left, price pill on the right, one tap target.</summary>
        private static Button PriceTile(string title, string price, int width, int height)
        {
            Ui.CardButton b = Ui.Card();
            b.Size = new Size(width, height);
            b.AccessibleName = title + ", " + price;
            b.Content = (g, r, self) =>
            {
                bool on = self.Enabled;
                int pill = Ui.Pill(g, price, Ui.Semi(10f), r.Right - 10, r.Y + r.Height / 2,
                    on ? Ui.AccentSoft : Ui.Background, on ? Ui.Accent : Ui.Faint);
                Ui.DrawText(g, title, Ui.Semi(10.5f), new Rectangle(r.X + 14, r.Y + 4, r.Width - pill - 34, r.Height - 8),
                    on ? Ui.Text : Ui.Muted, TextFormatFlags.VerticalCenter | TextFormatFlags.WordBreak | TextFormatFlags.EndEllipsis | TextFormatFlags.TextBoxControl);
            };
            return b;
        }

        /// <summary>Credit amount chip: "5 DT", or "Autre" to type it.</summary>
        private static Button AmountTile(string label, bool typed, int width, int height)
        {
            Ui.CardButton b = Ui.Card();
            b.Size = new Size(width, height);
            b.Radius = 12f;
            b.AccessibleName = label;
            b.Content = (g, r, self) =>
                Ui.DrawText(g, label, typed ? Ui.Semi(10.5f) : Ui.Semi(14f), r,
                    !self.Enabled ? Ui.Faint : typed ? Ui.Accent : Ui.Text, Ui.Centered);
            return b;
        }

        /// <summary>"Ooredoo" -> "OO", "Tunisie Telecom" -> "TT": stands in for the operator logo.</summary>
        private static string Initials(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return "?";
            string[] words = name.Split(new[] { ' ', '-' }, StringSplitOptions.RemoveEmptyEntries);
            string s = words.Length >= 2 ? words[0].Substring(0, 1) + words[1].Substring(0, 1) : words[0].Substring(0, Math.Min(2, words[0].Length));
            return s.ToUpperInvariant();
        }

        private static Label CenterNote(string text)
        {
            return new Label { Text = text, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, ForeColor = Ui.Muted };
        }

        private static IEnumerable<Button> AllButtons(Control root)
        {
            foreach (Control c in root.Controls)
            {
                var b = c as Button;
                if (b != null) yield return b;
                foreach (Button inner in AllButtons(c)) yield return inner;
            }
        }

        // ------------------------------------------------------------------ keyboard (optional, touch comes first)

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.F5) { var ignored = RefreshAllAsync(); return true; }
            if (keyData == Keys.F9) { ShowHistory(); return true; }
            if (_collapsed) return base.ProcessCmdKey(ref msg, keyData);
            if (keyData == Keys.Escape)
            {
                if (_step == Step.Number || _step == Step.Offer || _step == Step.Kind) GoBack();
                else if (_pending == null && !_sending) SetExpanded(false, false);
                return true;
            }
            if (_step == Step.Number)
            {
                // AZERTY keyboards type digits with Shift on the top row: accept the key with or without it.
                Keys k = keyData & ~Keys.Shift;
                if (k >= Keys.D0 && k <= Keys.D9) { PressKey(((int)(k - Keys.D0)).ToString()); return true; }
                if (k >= Keys.NumPad0 && k <= Keys.NumPad9) { PressKey(((int)(k - Keys.NumPad0)).ToString()); return true; }
                if (keyData == Keys.Back) { PressKey("⌫"); return true; }
                if (keyData == Keys.Delete) { PressKey("C"); return true; }
                if (keyData == Keys.Enter) { if (_send != null && _send.Enabled) OnSendOrNext(); return true; }
            }
            if (_step == Step.Result && keyData == Keys.Enter && _pending == null && !_sending)
            {
                StartNewSale();
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        // ------------------------------------------------------------------ data refresh

        private async Task RefreshAllAsync()
        {
            if (_refreshing || _closed) return;
            _refreshing = true;
            try
            {
                ApiClient api = _api;
                Task<MeResponse> meTask = Task.Run(() => api.GetMe());
                Task<List<Recharge>> histTask = Task.Run(() => api.GetRecharges(HistoryLimit));
                await Task.WhenAll(meTask, histTask);
                if (_closed) return;
                ApplyMe(meTask.Result);
                ApplyHistory(histTask.Result);
                SetConnected();
            }
            catch (ApiException ex)
            {
                if (ex.IsUnauthorized) { HandleRevoked(); return; }
                SetDisconnected();
            }
            finally
            {
                _refreshing = false;
            }
        }

        private async Task RefreshBalancesAsync()
        {
            if (_closed) return;
            try
            {
                ApiClient api = _api;
                MeResponse me = await Task.Run(() => api.GetMe());
                if (_closed) return;
                ApplyMe(me);
                SetConnected();
            }
            catch (ApiException ex)
            {
                if (ex.IsUnauthorized) HandleRevoked();
                else SetDisconnected();
            }
        }

        private void SetConnected()
        {
            string who = _me != null && _me.Terminal != null ? _me.Terminal.Name : _config.TerminalName;
            SetBarStatus((who ?? Strings.AppTitle) + " · " + DateTime.Now.ToString("HH:mm"), false);
        }

        private void SetDisconnected()
        {
            SetBarStatus(Strings.OfflineShort, true);
        }

        /// <summary>The bar shows the connection unless it is showing the result of a finished sale.</summary>
        private void SetBarStatus(string text, bool error)
        {
            _barStatus = text;
            _barError = error;
            if (_barShowsResult) return;
            _bar.BackColor = Ui.Surface;
            _barText.BackColor = Ui.Surface;
            _barText.ForeColor = error ? Ui.Danger : Ui.Muted;
            _barText.Font = Ui.F(9.5f);
            _barText.Dot = error ? Ui.Danger : text == Strings.Loading ? Ui.Faint : Ui.Accent;
            PaintMore(Ui.Surface, Ui.Text);
            _barText.Glyph = null;
            _barText.Text = text;
        }

        private void ApplyMe(MeResponse me)
        {
            if (me.Operators == null) me.Operators = new List<Operator>();
            if (me.Packages == null) me.Packages = new List<Package>();
            _me = me;

            if (_op != null) _op = me.Operators.FirstOrDefault(o => o.Code == _op.Code);
            if (_offer != null && _offer.Package != null)
            {
                Package fresh = me.Packages.FirstOrDefault(p => p.Id == _offer.Package.Id);
                if (fresh == null) _offer = null; else _offer.Package = fresh;
            }

            // Redraw only screens that show balances, never the keypad while the cashier types.
            if (_step == Step.Operator) ShowStep(Step.Operator);
            else if (_step == Step.Kind) ShowStep(_op == null ? Step.Operator : Step.Kind);
            else if (_step == Step.Offer) ShowStep(_op == null ? Step.Operator : Step.Offer);
            else if (_step == Step.Number && (_op == null || _offer == null)) ShowStep(Step.Operator);
        }

        // ------------------------------------------------------------------ sending

        private async Task SubmitPendingAsync()
        {
            PendingSale sale = _pending;
            if (sale == null || _sending || _closed) return;

            _sending = true;
            ShowStep(Step.Result);
            _bubble.Invalidate();
            try
            {
                ApiClient api = _api;
                CreateRechargeRequest req = sale.Request;
                Recharge r = await Task.Run(() => api.CreateRecharge(req));
                if (_closed) return;
                _pending = null;
                if (r != null)
                {
                    _resultId = r.Id;
                    ApplyRecharge(r);
                    if (!r.IsLive) Chime(r.Status);
                }
                SetConnected();
                var ignored = RefreshBalancesAsync();
            }
            catch (ApiException ex)
            {
                if (_closed) return;
                if (ex.IsUnauthorized) { HandleRevoked(); return; }
                if (ex.IsRetryable)
                {
                    // No definite answer: keep the same sale (same clientRef) so a retry can never charge twice.
                    SetDisconnected();
                }
                else
                {
                    // Definite refusal by the server: nothing was charged, the sale is over.
                    _pending = null;
                    _resultError = ex.FriendlyMessage;
                    SystemSounds.Hand.Play();
                    var ignored = RefreshBalancesAsync();
                }
            }
            finally
            {
                _sending = false;
                if (!_closed) { ShowStep(Step.Result); _bubble.Invalidate(); }
            }
        }

        private void AbandonPending()
        {
            if (_pending == null || _sending) return;
            if (MessageBox.Show(this, Strings.AbandonConfirm, Strings.AppTitle, MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                return;
            _pending = null;
            StartNewSale();
            var ignored = RefreshAllAsync();
        }

        // ------------------------------------------------------------------ history, polling, notices

        private static bool IsFinal(string status)
        {
            return status != null && status != "queued" && status != "sending";
        }

        private void ApplyHistory(List<Recharge> list)
        {
            var merged = new List<Recharge>(list.Count);
            foreach (Recharge incoming in list)
            {
                Recharge r = incoming;
                string known;
                if (_knownStatus.TryGetValue(r.Id, out known) && IsFinal(known) && r.IsLive)
                {
                    // A list fetched before the last poll: keep the newer, final state.
                    Recharge newer = _history.FirstOrDefault(x => x.Id == r.Id);
                    if (newer != null) r = newer;
                }
                NoteStatus(r);
                merged.Add(r);
            }
            _history = merged;
            if (_historyForm != null) _historyForm.SetItems(_history);
            if (_step == Step.Result && !_sending) ShowStep(Step.Result);
            _bubble.Invalidate();
        }

        private void ApplyRecharge(Recharge r)
        {
            int idx = _history.FindIndex(x => x.Id == r.Id);
            if (idx >= 0) _history[idx] = r;
            else _history.Insert(0, r);
            NoteStatus(r);
            if (_historyForm != null) _historyForm.SetItems(_history);
            if (_step == Step.Result && r.Id == _resultId && !_sending) ShowStep(Step.Result);
            _bubble.Invalidate();
        }

        /// <summary>When a live recharge becomes final, tells the cashier once: result screen, bottom bar, or the button's dot.</summary>
        private void NoteStatus(Recharge r)
        {
            string previous;
            bool hadPrevious = _knownStatus.TryGetValue(r.Id, out previous);
            _knownStatus[r.Id] = r.Status;
            if (!hadPrevious || IsFinal(previous) || !IsFinal(r.Status)) return;
            if (!_notified.Add(r.Id)) return; // e.g. a cancellation we asked for

            Chime(r.Status);
            bool onScreen = !_collapsed && _step == Step.Result && r.Id == _resultId;
            if (!onScreen) ShowBarResult(r);
            if (_collapsed)
                _bubbleMark = r.Status == "succeeded" ? "ok" : r.Status == "failed" ? "fail" : r.Status == "review" ? "review" : null;
        }

        private static void Chime(string status)
        {
            if (status == "succeeded") SystemSounds.Asterisk.Play();
            else if (status == "failed") SystemSounds.Hand.Play();
            else if (status == "review") SystemSounds.Exclamation.Play();
        }

        private void ShowBarResult(Recharge r)
        {
            Color back;
            Action<Graphics, RectangleF, Color> mark;
            switch (r.Status)
            {
                case "succeeded": back = Ui.Accent; mark = (g, b, c) => Ui.IconCheck(g, b, c, 2.2f); break;
                case "failed": back = Ui.Danger; mark = (g, b, c) => Ui.IconCross(g, b, c, 2.2f); break;
                case "review": back = Ui.Warning; mark = (g, b, c) => Ui.IconBang(g, b, c, 2.2f); break;
                default: back = Ui.Muted; mark = null; break;
            }
            _barShowsResult = true;
            _bar.BackColor = back;
            _barText.BackColor = back;
            _barText.ForeColor = Color.White;
            _barText.Font = Ui.Semi(9.5f);
            PaintMore(back, Color.White);
            _barText.Dot = Color.Empty;
            _barText.Glyph = mark;
            _barText.Text = Format.Msisdn(r.Msisdn) + " · " + Strings.Status(r.Status);
            _barTimer.Stop();
            _barTimer.Start();
        }

        /// <summary>The ⋯ button takes the colour of the bar it sits in.</summary>
        private void PaintMore(Color back, Color fore)
        {
            _more.Fill = back;
            _more.FillHover = back == Ui.Surface ? Ui.Background : Ui.Darken(back, 0.08);
            _more.FillPressed = back == Ui.Surface ? Ui.Line : Ui.Darken(back, 0.18);
            _more.ForeColor = fore;
            _more.Invalidate();
        }

        private void ClearBarResult()
        {
            _barTimer.Stop();
            _barShowsResult = false;
            SetBarStatus(_barStatus, _barError);
        }

        private async void OnPollTick(object sender, EventArgs e)
        {
            if (_polling || _closed) return;
            List<string> live = _history.Where(h => h.IsLive).Select(h => h.Id).ToList();
            if (live.Count == 0) return;

            _polling = true;
            bool anyFinal = false;
            try
            {
                ApiClient api = _api;
                foreach (string id in live)
                {
                    Recharge r;
                    try
                    {
                        string rid = id;
                        r = await Task.Run(() => api.GetRecharge(rid));
                    }
                    catch (ApiException ex)
                    {
                        if (_closed) return;
                        if (ex.IsUnauthorized) { HandleRevoked(); return; }
                        if (ex.Status == 404) continue;
                        SetDisconnected();
                        break; // try again on the next tick
                    }
                    if (_closed) return;
                    SetConnected();
                    if (r == null) continue;
                    if (!r.IsLive) anyFinal = true;
                    ApplyRecharge(r);
                }
            }
            finally
            {
                _polling = false;
            }
            if (anyFinal) await RefreshBalancesAsync();
        }

        private void ShowHistory()
        {
            if (_historyForm == null || _historyForm.IsDisposed)
            {
                _historyForm = new HistoryForm(code =>
                {
                    Operator op = _me != null ? _me.Operators.FirstOrDefault(o => o.Code == code) : null;
                    return op != null ? op.Name : code;
                });
                _historyForm.CancelRequested += OnCancelRequested;
            }
            _historyForm.SetItems(_history);
            _historyForm.ShowNear(this);
        }

        private async void OnCancelRequested(Recharge r)
        {
            if (r == null || r.Status != "queued" || _cancelling) return;
            string question = string.Format(Strings.CancelConfirm, r.Ref, Format.Msisdn(r.Msisdn), HistoryForm.Describe(r));
            if (MessageBox.Show(_historyForm, question, Strings.AppTitle, MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                return;

            _cancelling = true;
            _historyForm.Busy = true;
            try
            {
                ApiClient api = _api;
                string id = r.Id;
                Recharge updated = await Task.Run(() => api.CancelRecharge(id));
                if (_closed) return;
                if (updated != null)
                {
                    _notified.Add(updated.Id); // no failure notice for a cancellation we asked for
                    ApplyRecharge(updated);
                }
                await RefreshBalancesAsync();
            }
            catch (ApiException ex)
            {
                if (_closed) return;
                if (ex.IsUnauthorized) { HandleRevoked(); return; }
                MessageBox.Show(_historyForm, ex.FriendlyMessage, Strings.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                var ignored = RefreshAllAsync();
            }
            finally
            {
                _cancelling = false;
                if (_historyForm != null && !_historyForm.IsDisposed) _historyForm.Busy = false;
            }
        }

        // ------------------------------------------------------------------ pairing / closing

        private void HandleRevoked()
        {
            if (_closed) return;
            StopAll();
            _config.ClearToken();
            MessageBox.Show(this, Strings.Revoked, Strings.AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            BackToPairing = true;
            _forceClose = true;
            Close();
        }

        private void Unpair()
        {
            string question = Strings.UnpairConfirm;
            if (_pending != null) question = Strings.QuitWithPending + "\n\n" + question;
            if (MessageBox.Show(this, question, Strings.AppTitle, MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                return;
            StopAll();
            _config.ClearToken();
            BackToPairing = true;
            _forceClose = true;
            Close();
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (!_forceClose && (_pending != null || _sending))
            {
                if (MessageBox.Show(this, Strings.QuitWithPending, Strings.AppTitle, MessageBoxButtons.YesNo,
                        MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                {
                    e.Cancel = true;
                    return;
                }
            }
            WindowPrefs.SaveCorner(new Point(Right, Bottom));
            StopAll();
            if (_historyForm != null && !_historyForm.IsDisposed) _historyForm.Dispose();
        }

        private void StopAll()
        {
            _closed = true;
            _pollTimer.Stop();
            _refreshTimer.Stop();
            _barTimer.Stop();
            _autoCollapse.Stop();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _pollTimer.Dispose();
                _refreshTimer.Dispose();
                _barTimer.Dispose();
                _autoCollapse.Dispose();
                _menu.Dispose();
            }
            base.Dispose(disposing);
        }

        /// <summary>
        /// The folded button: the Sarfli app icon (brand green tile, gold coin mark). A dot tells what happened while it was folded
        /// (amber = a sale is sending, green = done, red = failed, orange = to check).
        /// </summary>
        private sealed class BubbleButton : Control
        {
            public Func<string> Mark;
            private bool _down;

            public BubbleButton()
            {
                SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
                Cursor = Cursors.Hand;
                AccessibleRole = AccessibleRole.PushButton;
                AccessibleName = Strings.AppTitle;
            }

            protected override void OnMouseDown(MouseEventArgs e) { _down = true; Invalidate(); base.OnMouseDown(e); }
            protected override void OnMouseUp(MouseEventArgs e) { _down = false; Invalidate(); base.OnMouseUp(e); }
            protected override void OnMouseLeave(EventArgs e) { _down = false; Invalidate(); base.OnMouseLeave(e); }

            protected override void OnPaint(PaintEventArgs e)
            {
                Graphics g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                // Press feedback: a darker green, like a key going down.
                Color back = _down ? Ui.AccentPressed : Ui.Accent;
                using (var br = new LinearGradientBrush(ClientRectangle, _down ? back : Ui.Mix(back, Color.White, 0.12), back, LinearGradientMode.Vertical))
                    g.FillRectangle(br, ClientRectangle);
                // app-icon.svg proportions: the coin fills about two thirds of the tile.
                float m = Width * 0.17f;
                Ui.DrawMark(g, new RectangleF(m, m, Width - 2 * m, Height - 2 * m), back);
                string mark = Mark != null ? Mark() : null;
                Color? dot = mark == "live" ? Color.FromArgb(255, 196, 0)
                    : mark == "ok" ? Color.FromArgb(120, 230, 160)
                    : mark == "fail" ? Color.FromArgb(255, 80, 80)
                    : mark == "review" ? Color.FromArgb(255, 150, 40) : (Color?)null;
                if (dot != null)
                {
                    using (var ring = new SolidBrush(Color.White)) g.FillEllipse(ring, Width - 25, 7, 18, 18);
                    using (var br = new SolidBrush(dot.Value)) g.FillEllipse(br, Width - 22, 10, 12, 12);
                }
            }
        }
    }

    /// <summary>Four short segments under the title: where the cashier is in the sale (operator, type, offer, number).</summary>
    internal sealed class StepDots : Control
    {
        private int _done;

        public StepDots()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            Height = 4;
            BackColor = Ui.Surface;
        }

        public int Done
        {
            get { return _done; }
            set { if (_done != value) { _done = value; Invalidate(); } }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(BackColor);
            const int count = 4, gap = 4, side = 12;
            float w = (Width - 2 * side - (count - 1) * gap) / (float)count;
            for (int i = 0; i < count; i++)
            {
                var r = new RectangleF(side + i * (w + gap), 0, w, 3);
                Ui.FillRound(g, r, 1.5f, i < _done ? Ui.Accent : Ui.Line, Color.Empty);
            }
        }
    }

    /// <summary>The bottom bar text: a connection dot (or a result icon) and one line of text.</summary>
    internal sealed class BarLabel : Control
    {
        public Color Dot = Color.Empty;
        public Action<Graphics, RectangleF, Color> Glyph;

        public BarLabel()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            Cursor = Cursors.Hand;
        }

        protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }
        protected override void OnBackColorChanged(EventArgs e) { Invalidate(); base.OnBackColorChanged(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(BackColor);
            int x = 14;
            if (Glyph != null)
            {
                Glyph(g, new RectangleF(x - 3, (Height - 20) / 2f, 20, 20), ForeColor);
                x += 22;
            }
            else if (!Dot.IsEmpty)
            {
                SmoothingMode old = g.SmoothingMode;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (var halo = new SolidBrush(Color.FromArgb(48, Dot))) g.FillEllipse(halo, x - 3, Height / 2f - 6, 12, 12);
                using (var br = new SolidBrush(Dot)) g.FillEllipse(br, x, Height / 2f - 3, 6, 6);
                g.SmoothingMode = old;
                x += 16;
            }
            Ui.DrawText(g, Text, Font, new Rectangle(x, 0, Width - x - 4, Height), ForeColor, Ui.OneLine);
        }
    }

    /// <summary>The keypad display: the number (or amount) being typed, large, with one line of context under it.</summary>
    internal sealed class DisplayCard : Control
    {
        private string _value = "", _hint = "";
        private Color _valueColor = Ui.Text, _hintColor = Ui.Muted;

        public DisplayCard()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        }

        public void Set(string value, Color valueColor, string hint, Color hintColor)
        {
            _value = value; _valueColor = valueColor; _hint = hint; _hintColor = hintColor;
            AccessibleName = value + ", " + hint;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(Ui.BackOf(Parent));
            var r = new Rectangle(0, 0, Width - 1, Height - 1);
            Ui.FillRound(g, r, 14f, Ui.Surface, Ui.Line);
            Ui.DrawText(g, _value, Ui.Semi(20f), new Rectangle(8, 6, Width - 16, 34), _valueColor, Ui.Centered);
            Ui.DrawText(g, _hint, Ui.F(9.5f), new Rectangle(8, 40, Width - 16, 18), _hintColor, Ui.Centered);
        }
    }

    /// <summary>The outcome of a sale: a big status icon, a headline, and the details, centered.</summary>
    internal sealed class ResultView : Control
    {
        public enum Glyph { None, Check, Cross, Bang, Wait }

        public string Head = "";
        public string Detail = "";
        public Color Tone = Ui.Text;
        public Glyph Icon = Glyph.None;

        public ResultView()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(Ui.BackOf(Parent));
            // Center the whole block (icon, headline, details) in the free space above the buttons.
            const TextFormatFlags wrap = TextFormatFlags.HorizontalCenter | TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding;
            int detailH = string.IsNullOrEmpty(Detail) ? 0
                : TextRenderer.MeasureText(g, Detail, Ui.F(10.5f), new Size(Width - 12, int.MaxValue), wrap).Height;
            int total = (Icon != Glyph.None ? 76 : 0) + (string.IsNullOrEmpty(Head) ? 0 : 32) + detailH;
            int y = Math.Max(6, (Height - total) / 2 - 4);
            if (Icon != Glyph.None)
            {
                const int d = 64;
                var circle = new Rectangle((Width - d) / 2, y, d, d);
                Ui.FillRound(g, circle, d / 2f, Ui.Mix(Tone, Color.White, 0.85), Color.Empty);
                var box = new RectangleF(circle.X + 12, circle.Y + 12, d - 24, d - 24);
                switch (Icon)
                {
                    case Glyph.Check: Ui.IconCheck(g, box, Tone, 4f); break;
                    case Glyph.Cross: Ui.IconCross(g, box, Tone, 4f); break;
                    case Glyph.Bang: Ui.IconBang(g, box, Tone, 4f); break;
                    case Glyph.Wait: Ui.IconClock(g, box, Tone, 3f); break;
                }
                y = circle.Bottom + 12;
            }
            if (!string.IsNullOrEmpty(Head))
            {
                Ui.DrawText(g, Head, Ui.Semi(15f), new Rectangle(4, y, Width - 8, 28), Tone == Ui.Muted ? Ui.Text : Tone, Ui.Centered);
                y += 32;
            }
            if (!string.IsNullOrEmpty(Detail))
                Ui.DrawText(g, Detail, Ui.F(10.5f), new Rectangle(6, y, Width - 12, Height - y), Ui.Muted,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.WordBreak | TextFormatFlags.EndEllipsis | TextFormatFlags.TextBoxControl);
        }
    }

    /// <summary>Where the panel sits (its bottom-right corner) and whether it stays on top, remembered per Windows user.</summary>
    internal static class WindowPrefs
    {
        private static string FilePath { get { return Path.Combine(PosConfig.Folder, "window"); } }

        private static string[] Read()
        {
            try { return File.Exists(FilePath) ? File.ReadAllText(FilePath).Split(';') : new string[0]; }
            catch (Exception) { return new string[0]; }
        }

        private static void Write(Point? corner, bool? onTop)
        {
            string[] cur = Read();
            Point c = corner ?? ParsePoint(cur);
            bool top = onTop ?? (cur.Length < 3 || cur[2] != "0");
            try
            {
                Directory.CreateDirectory(PosConfig.Folder);
                File.WriteAllText(FilePath, c.X + ";" + c.Y + ";" + (top ? "1" : "0") + ";corner");
            }
            catch (Exception) { }
        }

        private static Point ParsePoint(string[] parts)
        {
            int x, y;
            // Older files stored the top-left of the big panel: ignore them.
            if (parts.Length >= 4 && parts[3] == "corner" && int.TryParse(parts[0], out x) && int.TryParse(parts[1], out y)) return new Point(x, y);
            return new Point(int.MinValue, int.MinValue);
        }

        public static bool OnTop
        {
            get { string[] p = Read(); return p.Length < 3 || p[2] != "0"; }
            set { Write(null, value); }
        }

        public static void SaveCorner(Point corner)
        {
            Write(corner, null);
        }

        /// <summary>The saved corner if the panel would still fit on a screen, otherwise the bottom-right of the main screen.</summary>
        public static Point Corner(Size panel)
        {
            Point saved = ParsePoint(Read());
            if (saved.X != int.MinValue)
            {
                var rect = new Rectangle(saved.X - panel.Width, saved.Y - panel.Height, panel.Width, panel.Height);
                if (Screen.AllScreens.Any(s => s.WorkingArea.Contains(rect))) return saved;
            }
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            return new Point(area.Right - 12, area.Bottom - 12);
        }
    }
}
