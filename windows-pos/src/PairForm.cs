using System;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace SarfliPos
{
    /// <summary>First screen: exchange a 6-digit code from sarfli.com for a terminal token.</summary>
    internal sealed class PairForm : Form
    {
        private readonly TextBox _code;
        private readonly TextBox _name;
        private readonly TextBox _server;
        private readonly Label _serverLabel;
        private readonly Control _serverBox;
        private readonly LinkLabel _advanced;
        private readonly Button _pair;
        private readonly Label _status;
        private bool _busy;

        public PosConfig Result { get; private set; }

        public PairForm(string previousApiBase)
        {
            Text = Strings.PairTitle;
            Font = Ui.F(11f);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(560, 500);
            BackColor = Ui.Surface;
            Icon = Ui.AppIcon;

            var layout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(32, 24, 32, 16),
                ColumnCount = 1,
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            Controls.Add(layout);

            // Brand mark next to the name, from assets/brand.
            var title = new Label
            {
                Text = Strings.AppTitle,
                Font = Ui.Semi(20f),
                ForeColor = Ui.Text,
                AutoSize = true,
                Padding = new Padding(50, 0, 0, 0),
                MinimumSize = new Size(0, 44),
                TextAlign = ContentAlignment.MiddleLeft,
                Margin = new Padding(0, 0, 0, 8),
            };
            title.Paint += (s, e) =>
            {
                // The app icon: green rounded tile with the gold coin.
                var tile = new RectangleF(0, (title.Height - 40) / 2f, 40, 40);
                Ui.FillRound(e.Graphics, tile, 11f, Ui.Accent, Color.Empty);
                tile.Inflate(-7, -7);
                Ui.DrawMark(e.Graphics, tile, Ui.Accent);
            };
            var intro = new Label
            {
                Text = Strings.PairIntro,
                AutoSize = true,
                MaximumSize = new Size(500, 0),
                ForeColor = Ui.Muted,
                Margin = new Padding(0, 0, 0, 16),
            };

            _code = new TextBox
            {
                Font = new Font("Consolas", 24f, FontStyle.Bold),
                MaxLength = 6,
                TextAlign = HorizontalAlignment.Center,
            };
            _code.KeyPress += (s, e) =>
            {
                if (!char.IsControl(e.KeyChar) && !char.IsDigit(e.KeyChar)) e.Handled = true;
            };

            _name = new TextBox { Text = Environment.MachineName };

            _advanced = new LinkLabel
            {
                Text = Strings.PairAdvanced,
                AutoSize = true,
                Margin = new Padding(0, 0, 0, 6),
                LinkColor = Ui.Accent,
                ActiveLinkColor = Ui.AccentPressed,
                LinkBehavior = LinkBehavior.HoverUnderline,
            };
            _serverLabel = FieldLabel(Strings.PairServer);
            _serverLabel.Visible = false;
            _server = new TextBox { Text = PosConfig.ServerFromApiBase(previousApiBase) };
            _serverBox = Field(_server, 440, 40);
            _serverBox.Visible = false;
            _advanced.LinkClicked += (s, e) =>
            {
                bool show = !_serverBox.Visible;
                _serverLabel.Visible = show;
                _serverBox.Visible = show;
                if (show) _server.Focus();
            };
            // Show the field directly if a non-default server was used before.
            if (!string.Equals(_server.Text, PosConfig.DefaultServer, StringComparison.OrdinalIgnoreCase))
            {
                _serverLabel.Visible = true;
                _serverBox.Visible = true;
            }

            _pair = Ui.Primary(Strings.PairButton);
            _pair.Font = Ui.Semi(13f);
            _pair.Size = new Size(220, 50);
            _pair.Margin = new Padding(0, 12, 0, 8);
            _pair.Click += OnPairClick;

            _status = new Label { AutoSize = true, MaximumSize = new Size(500, 0), ForeColor = Ui.Danger };

            layout.Controls.Add(title);
            layout.Controls.Add(intro);
            layout.Controls.Add(FieldLabel(Strings.PairCode));
            layout.Controls.Add(Field(_code, 220, 56));
            layout.Controls.Add(FieldLabel(Strings.PairTerminalName));
            layout.Controls.Add(Field(_name, 340, 40));
            layout.Controls.Add(_advanced);
            layout.Controls.Add(_serverLabel);
            layout.Controls.Add(_serverBox);
            layout.Controls.Add(_pair);
            layout.Controls.Add(_status);

            // Tab order follows the visual order.
            _code.TabIndex = 0;
            _name.TabIndex = 1;
            _advanced.TabIndex = 2;
            _server.TabIndex = 3;
            _pair.TabIndex = 4;

            AcceptButton = _pair;
            Shown += (s, e) => _code.Focus();
        }

        private static Label FieldLabel(string text)
        {
            return new Label { Text = text, AutoSize = true, Font = Ui.Semi(10.5f), ForeColor = Ui.Text, Margin = new Padding(0, 0, 0, 4) };
        }

        /// <summary>
        /// A borderless TextBox inside a rounded box. The border turns green while the field has focus,
        /// so the cashier sees where typing goes. Tapping anywhere in the box focuses the field.
        /// </summary>
        private static Control Field(TextBox box, int width, int height)
        {
            var frame = new FieldFrame { Size = new Size(width, height), Margin = new Padding(0, 0, 0, 14) };
            box.BorderStyle = BorderStyle.None;
            box.BackColor = Ui.Surface;
            box.ForeColor = Ui.Text;
            int h = box.PreferredHeight;
            box.SetBounds(14, (height - h) / 2, width - 28, h);
            box.Anchor = AnchorStyles.Left | AnchorStyles.Right;
            box.Enter += (s, e) => { frame.Focused2 = true; frame.Invalidate(); };
            box.Leave += (s, e) => { frame.Focused2 = false; frame.Invalidate(); };
            box.EnabledChanged += (s, e) => { box.BackColor = box.Enabled ? Ui.Surface : Ui.Background; frame.Invalidate(); };
            frame.MouseDown += (s, e) => box.Focus();
            frame.Controls.Add(box);
            return frame;
        }

        private sealed class FieldFrame : Panel
        {
            public bool Focused2;

            public FieldFrame()
            {
                SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
                Cursor = Cursors.IBeam;
            }

            protected override void OnPaint(PaintEventArgs e)
            {
                Graphics g = e.Graphics;
                g.Clear(Ui.BackOf(Parent));
                bool on = Controls.Count == 0 || Controls[0].Enabled;
                var r = new Rectangle(1, 1, Width - 3, Height - 3);
                Ui.FillRound(g, r, 10f, on ? Ui.Surface : Ui.Background, Focused2 ? Ui.Accent : Ui.Line);
                if (Focused2)
                {
                    // A second ring, 2 px in total: clearly visible, still calm.
                    r.Inflate(1, 1);
                    using (var path = Ui.RoundRect(r, 11f))
                    using (var pen = new Pen(Color.FromArgb(90, Ui.Accent)))
                    {
                        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                        g.DrawPath(pen, path);
                    }
                }
            }
        }

        private async void OnPairClick(object sender, EventArgs e)
        {
            if (_busy) return;
            string code = _code.Text.Trim();
            if (code.Length != 6)
            {
                ShowError(Strings.PairCodeInvalidFormat);
                _code.Focus();
                return;
            }

            string apiBase = PosConfig.NormalizeApiBase(_server.Text);
            Uri uri;
            if (!Uri.TryCreate(apiBase, UriKind.Absolute, out uri) ||
                (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            {
                ShowError(Strings.PairServerInvalid);
                return;
            }

            string deviceName = _name.Text.Trim();
            if (deviceName.Length == 0) deviceName = Environment.MachineName;

            SetBusy(true);
            try
            {
                var client = new ApiClient(apiBase, null);
                PairResponse resp = await Task.Run(() => client.Pair(code, deviceName));
                if (string.IsNullOrEmpty(resp.Token)) throw new ApiException(0, "bad_response");

                var config = new PosConfig
                {
                    ApiBase = apiBase,
                    Token = resp.Token,
                    TerminalName = resp.Terminal != null ? resp.Terminal.Name : deviceName,
                };
                config.Save();
                Result = config;
                DialogResult = DialogResult.OK;
                Close();
            }
            catch (ApiException ex)
            {
                ShowError(ex.FriendlyMessage);
                if (ex.Code == "invalid_code")
                {
                    _code.SelectAll();
                    _code.Focus();
                }
            }
            catch (Exception ex)
            {
                ShowError(Strings.UnexpectedError + " " + ex.Message);
            }
            finally
            {
                if (!IsDisposed) SetBusy(false);
            }
        }

        private void SetBusy(bool busy)
        {
            _busy = busy;
            _pair.Enabled = !busy;
            _code.Enabled = !busy;
            _name.Enabled = !busy;
            _server.Enabled = !busy;
            if (busy)
            {
                _status.ForeColor = Ui.Muted;
                _status.Text = Strings.PairWorking;
            }
            UseWaitCursor = busy;
        }

        private void ShowError(string message)
        {
            _status.ForeColor = Ui.Danger;
            _status.Text = message;
        }
    }
}
