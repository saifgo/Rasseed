using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace SarfliPos
{
    /// <summary>
    /// Shared look, from the Sarfli brand kit (assets/brand) and web/DESIGN.md: one emerald accent, neutral surfaces,
    /// rounded cards, instant press feedback. Everything is drawn with plain GDI+ (no animation, no extra DLL),
    /// so it renders the same on Windows 7 and Windows 11 and costs nothing while idle.
    /// </summary>
    internal static class Ui
    {
        // assets/brand/app-icon.svg: background #0f6e56, coin #e3a93b, coin ring #ca922b
        public static readonly Color Accent = Color.FromArgb(0x0f, 0x6e, 0x56);
        public static readonly Color AccentHover = Color.FromArgb(0x0d, 0x62, 0x4c);
        public static readonly Color AccentPressed = Color.FromArgb(0x0a, 0x52, 0x40);
        public static readonly Color AccentSoft = Color.FromArgb(0xe3, 0xf1, 0xec);
        public static readonly Color AccentDisabled = Color.FromArgb(0xb4, 0xcc, 0xc3);
        public static readonly Color Gold = Color.FromArgb(0xe3, 0xa9, 0x3b);
        public static readonly Color GoldRing = Color.FromArgb(0xca, 0x92, 0x2b);
        public static readonly Color Surface = Color.White;
        public static readonly Color Background = Color.FromArgb(0xf3, 0xf4, 0xf6);
        public static readonly Color Text = Color.FromArgb(0x1c, 0x1c, 0x1e);
        public static readonly Color Muted = Color.FromArgb(0x6b, 0x6e, 0x76);
        public static readonly Color Faint = Color.FromArgb(0xa6, 0xa9, 0xb0);
        public static readonly Color Line = Color.FromArgb(0xe3, 0xe5, 0xe9);
        public static readonly Color Danger = Color.FromArgb(0xc8, 0x24, 0x24);
        public static readonly Color Warning = Color.FromArgb(0xc2, 0x6a, 0x00);

        // ------------------------------------------------------------------ fonts (cached: a Font is a GDI handle)

        private static readonly Dictionary<string, Font> Fonts = new Dictionary<string, Font>();
        private static bool? _hasSemibold;

        public static Font F(float size, FontStyle style = FontStyle.Regular)
        {
            return Cached("Segoe UI", size, style);
        }

        /// <summary>Segoe UI Semibold (ships with Windows 7 and later); Bold if it is missing.</summary>
        public static Font Semi(float size)
        {
            if (_hasSemibold == null)
            {
                using (var probe = new Font("Segoe UI Semibold", 10f)) _hasSemibold = probe.Name == "Segoe UI Semibold";
            }
            return _hasSemibold.Value ? Cached("Segoe UI Semibold", size, FontStyle.Regular) : F(size, FontStyle.Bold);
        }

        private static Font Cached(string family, float size, FontStyle style)
        {
            string key = family + "|" + size + "|" + (int)style;
            Font f;
            if (!Fonts.TryGetValue(key, out f))
            {
                f = new Font(family, size, style);
                Fonts[key] = f;
            }
            return f;
        }

        // ------------------------------------------------------------------ colour helpers

        public static Color Darken(Color c, double amount)
        {
            return Color.FromArgb((int)(c.R * (1 - amount)), (int)(c.G * (1 - amount)), (int)(c.B * (1 - amount)));
        }

        /// <summary>a at t = 0, b at t = 1.</summary>
        public static Color Mix(Color a, Color b, double t)
        {
            return Color.FromArgb(
                (int)(a.R + (b.R - a.R) * t),
                (int)(a.G + (b.G - a.G) * t),
                (int)(a.B + (b.B - a.B) * t));
        }

        /// <summary>The first solid background colour up the parent chain (what shows around rounded corners).</summary>
        public static Color BackOf(Control c)
        {
            for (Control p = c; p != null; p = p.Parent)
                if (p.BackColor.A == 255) return p.BackColor;
            return Background;
        }

        // ------------------------------------------------------------------ drawing helpers

        public static GraphicsPath RoundRect(RectangleF r, float radius)
        {
            var p = new GraphicsPath();
            float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            if (d <= 0.5f) { p.AddRectangle(r); return p; }
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        public static void FillRound(Graphics g, RectangleF r, float radius, Color fill, Color border)
        {
            SmoothingMode old = g.SmoothingMode;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (GraphicsPath path = RoundRect(r, radius))
            {
                using (var br = new SolidBrush(fill)) g.FillPath(br, path);
                if (!border.IsEmpty)
                    using (var pen = new Pen(border, 1f)) g.DrawPath(pen, path);
            }
            g.SmoothingMode = old;
        }

        public static void DrawText(Graphics g, string text, Font font, Rectangle r, Color color, TextFormatFlags flags)
        {
            TextRenderer.DrawText(g, text, font, r, color, flags | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding);
        }

        public const TextFormatFlags OneLine = TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.VerticalCenter;
        public const TextFormatFlags Centered = OneLine | TextFormatFlags.HorizontalCenter;

        /// <summary>A rounded "badge" pill with a short text, right-aligned on <paramref name="right"/>. Returns its width.</summary>
        public static int Pill(Graphics g, string text, Font font, int right, int centerY, Color back, Color fore, bool fromLeft = false)
        {
            Size s = TextRenderer.MeasureText(g, text, font, Size.Empty, TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
            int w = s.Width + 18, h = s.Height + 8;
            var r = new Rectangle(fromLeft ? right : right - w, centerY - h / 2, w, h);
            FillRound(g, r, h / 2f, back, Color.Empty);
            DrawText(g, text, font, r, fore, Centered);
            return w;
        }

        // ------------------------------------------------------------------ icons (vector, so no missing-glyph boxes on Windows 7)

        private static Pen Stroke(Color c, float w)
        {
            return new Pen(c, w) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
        }

        private static void Smooth(Graphics g, Action draw)
        {
            SmoothingMode old = g.SmoothingMode;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            draw();
            g.SmoothingMode = old;
        }

        public static void IconChevron(Graphics g, RectangleF r, Color c, bool left, float w = 2f)
        {
            Smooth(g, () =>
            {
                float s = Math.Min(r.Width, r.Height) * 0.5f, cx = r.X + r.Width / 2, cy = r.Y + r.Height / 2;
                float dx = s * 0.25f * (left ? 1 : -1);
                using (Pen p = Stroke(c, w))
                    g.DrawLines(p, new[] { new PointF(cx + dx, cy - s / 2), new PointF(cx - dx, cy), new PointF(cx + dx, cy + s / 2) });
            });
        }

        public static void IconMinus(Graphics g, RectangleF r, Color c)
        {
            Smooth(g, () =>
            {
                float s = Math.Min(r.Width, r.Height) * 0.2f, cx = r.X + r.Width / 2, cy = r.Y + r.Height / 2;
                using (Pen p = Stroke(c, 2f)) g.DrawLine(p, cx - s, cy, cx + s, cy);
            });
        }

        public static void IconDots(Graphics g, RectangleF r, Color c)
        {
            Smooth(g, () =>
            {
                float cx = r.X + r.Width / 2, cy = r.Y + r.Height / 2, d = 4f;
                using (var br = new SolidBrush(c))
                    for (int i = -1; i <= 1; i++) g.FillEllipse(br, cx + i * 7 - d / 2, cy - d / 2, d, d);
            });
        }

        public static void IconCheck(Graphics g, RectangleF r, Color c, float w)
        {
            Smooth(g, () =>
            {
                using (Pen p = Stroke(c, w))
                    g.DrawLines(p, new[]
                    {
                        new PointF(r.X + r.Width * 0.22f, r.Y + r.Height * 0.53f),
                        new PointF(r.X + r.Width * 0.42f, r.Y + r.Height * 0.72f),
                        new PointF(r.X + r.Width * 0.78f, r.Y + r.Height * 0.32f),
                    });
            });
        }

        public static void IconCross(Graphics g, RectangleF r, Color c, float w)
        {
            Smooth(g, () =>
            {
                float a = 0.3f, b = 0.7f;
                using (Pen p = Stroke(c, w))
                {
                    g.DrawLine(p, r.X + r.Width * a, r.Y + r.Height * a, r.X + r.Width * b, r.Y + r.Height * b);
                    g.DrawLine(p, r.X + r.Width * b, r.Y + r.Height * a, r.X + r.Width * a, r.Y + r.Height * b);
                }
            });
        }

        public static void IconBang(Graphics g, RectangleF r, Color c, float w)
        {
            Smooth(g, () =>
            {
                float cx = r.X + r.Width / 2;
                using (Pen p = Stroke(c, w)) g.DrawLine(p, cx, r.Y + r.Height * 0.26f, cx, r.Y + r.Height * 0.58f);
                using (var br = new SolidBrush(c)) g.FillEllipse(br, cx - w * 0.65f, r.Y + r.Height * 0.72f - w * 0.65f, w * 1.3f, w * 1.3f);
            });
        }

        /// <summary>A clock face: "waiting", without any spinner to animate.</summary>
        public static void IconClock(Graphics g, RectangleF r, Color c, float w)
        {
            Smooth(g, () =>
            {
                float cx = r.X + r.Width / 2, cy = r.Y + r.Height / 2, rad = Math.Min(r.Width, r.Height) * 0.3f;
                using (Pen p = Stroke(c, w))
                {
                    g.DrawEllipse(p, cx - rad, cy - rad, rad * 2, rad * 2);
                    g.DrawLines(p, new[] { new PointF(cx, cy - rad * 0.55f), new PointF(cx, cy), new PointF(cx + rad * 0.45f, cy + rad * 0.3f) });
                }
            });
        }

        /// <summary>Lightning bolt: plain credit ("Light").</summary>
        public static void IconBolt(Graphics g, RectangleF r, Color c)
        {
            Smooth(g, () =>
            {
                Func<float, float, PointF> P = (x, y) => new PointF(r.X + r.Width * x, r.Y + r.Height * y);
                using (var br = new SolidBrush(c))
                    g.FillPolygon(br, new[] { P(0.58f, 0.14f), P(0.28f, 0.56f), P(0.48f, 0.56f), P(0.42f, 0.86f), P(0.72f, 0.42f), P(0.52f, 0.42f) });
            });
        }

        /// <summary>Signal waves: data package ("Internet").</summary>
        public static void IconSignal(Graphics g, RectangleF r, Color c)
        {
            Smooth(g, () =>
            {
                float cx = r.X + r.Width / 2, by = r.Y + r.Height * 0.74f;
                using (Pen p = Stroke(c, Math.Max(2f, r.Width * 0.08f)))
                {
                    for (int i = 1; i <= 3; i++)
                    {
                        float rad = r.Width * 0.13f * i;
                        g.DrawArc(p, cx - rad, by - rad, rad * 2, rad * 2, 225, 90);
                    }
                }
                float d = r.Width * 0.12f;
                using (var br = new SolidBrush(c)) g.FillEllipse(br, cx - d / 2, by - d / 2, d, d);
            });
        }

        public static void IconBackspace(Graphics g, RectangleF r, Color c)
        {
            Smooth(g, () =>
            {
                float h = Math.Min(r.Width, r.Height) * 0.4f, w = h * 1.45f;
                float x = r.X + (r.Width - w) / 2, y = r.Y + (r.Height - h) / 2;
                using (Pen p = Stroke(c, 1.8f))
                {
                    g.DrawPolygon(p, new[]
                    {
                        new PointF(x, y + h / 2), new PointF(x + h * 0.45f, y), new PointF(x + w, y),
                        new PointF(x + w, y + h), new PointF(x + h * 0.45f, y + h),
                    });
                    float cx = x + h * 0.45f + (w - h * 0.45f) / 2, cy = y + h / 2, s = h * 0.18f;
                    g.DrawLine(p, cx - s, cy - s, cx + s, cy + s);
                    g.DrawLine(p, cx + s, cy - s, cx - s, cy + s);
                }
            });
        }

        // ------------------------------------------------------------------ buttons

        /// <summary>
        /// A rounded, owner-drawn button. It reacts on press (not release): darker fill and a 1–2 px "push in".
        /// Still a real Button, so Click, Enabled, Tab, Space and screen readers behave as before.
        /// </summary>
        public class CardButton : Button
        {
            public float Radius = 12f;
            public Color Fill = Surface;
            public Color FillHover = Color.Empty;     // empty = Fill, a shade darker
            public Color FillPressed = Color.Empty;   // empty = Fill, darker
            public Color FillDisabled = Color.Empty;  // empty = Fill faded into the background
            public Color Border = Line;               // empty = none
            public Color ForeDisabled = Faint;
            /// <summary>Draws the content inside the (pushed-in) card rectangle. Null = centered Text.</summary>
            public Action<Graphics, Rectangle, CardButton> Content;

            private bool _hover, _down;

            public bool IsPressed { get { return _down; } }

            public CardButton()
            {
                SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                         ControlStyles.ResizeRedraw, true);
                FlatStyle = FlatStyle.Flat;
                FlatAppearance.BorderSize = 0;
                Cursor = Cursors.Hand;
                UseMnemonic = false;
                ForeColor = Ui.Text;
                Font = F(11f);
            }

            /// <summary>On a touch screen a focus box reads as "already selected": the pressed fill is the feedback.</summary>
            protected override bool ShowFocusCues { get { return false; } }

            protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
            protected override void OnMouseLeave(EventArgs e) { _hover = false; _down = false; Invalidate(); base.OnMouseLeave(e); }
            protected override void OnMouseDown(MouseEventArgs e)
            {
                if (e.Button == MouseButtons.Left) { _down = true; Invalidate(); Update(); } // paint now, before any work
                base.OnMouseDown(e);
            }
            protected override void OnMouseUp(MouseEventArgs e) { _down = false; Invalidate(); base.OnMouseUp(e); }
            protected override void OnEnabledChanged(EventArgs e) { if (!Enabled) { _down = false; _hover = false; } Invalidate(); base.OnEnabledChanged(e); }

            protected override void OnPaintBackground(PaintEventArgs e) { }

            protected override void OnPaint(PaintEventArgs e)
            {
                Graphics g = e.Graphics;
                Color around = BackOf(Parent);
                g.Clear(around);

                Color fill;
                if (!Enabled) fill = FillDisabled.IsEmpty ? Mix(Fill, around, 0.55) : FillDisabled;
                else if (_down) fill = FillPressed.IsEmpty ? Darken(Fill, 0.07) : FillPressed;
                else if (_hover) fill = FillHover.IsEmpty ? Darken(Fill, 0.025) : FillHover;
                else fill = Fill;

                var r = new Rectangle(0, 0, Width - 1, Height - 1);
                if (_down) { int inset = Height >= 48 ? 2 : 1; r.Inflate(-inset, -inset); }
                Color border = Border.IsEmpty ? Color.Empty : (Enabled ? Border : Mix(Border, around, 0.25));
                FillRound(g, r, Radius, fill, border);

                if (Content != null) Content(g, r, this);
                else if (!string.IsNullOrEmpty(Text))
                    DrawText(g, Text, Font, r, Enabled ? ForeColor : ForeDisabled, Centered);
            }
        }

        /// <summary>A white rounded card (light border) for picking something.</summary>
        public static CardButton Card()
        {
            return new CardButton { Fill = Surface, Border = Line, Radius = 14f };
        }

        /// <summary>A neutral rounded button with centered text.</summary>
        public static CardButton Secondary(string text)
        {
            return new CardButton { Text = text, Fill = Surface, Border = Line, Font = Semi(11f), ForeColor = Text };
        }

        /// <summary>The one green "go" button of a screen.</summary>
        public static CardButton Primary(string text)
        {
            return new CardButton
            {
                Text = text,
                Fill = Accent,
                FillHover = AccentHover,
                FillPressed = AccentPressed,
                FillDisabled = AccentDisabled,
                ForeDisabled = Color.FromArgb(240, 246, 244),
                Border = Color.Empty,
                ForeColor = Color.White,
                Font = Semi(12.5f),
            };
        }

        /// <summary>A borderless square header/footer button drawn with a vector icon.</summary>
        public static CardButton IconButton(Action<Graphics, RectangleF, Color> icon, string accessibleName)
        {
            var b = new CardButton
            {
                Fill = Surface,
                FillHover = Background,
                FillPressed = Line,
                Border = Color.Empty,
                Radius = 10f,
                Width = 44,
                TabStop = false,
                AccessibleName = accessibleName,
            };
            b.Content = (g, r, self) =>
            {
                var box = new RectangleF(r.X + (r.Width - 24) / 2f, r.Y + (r.Height - 24) / 2f, 24, 24);
                icon(g, box, self.Enabled ? self.ForeColor : Faint);
            };
            return b;
        }

        /// <summary>One line of text, cut with "…" when too long (a plain Label wraps onto a second line).</summary>
        public sealed class OneLineLabel : Label
        {
            protected override void OnPaint(PaintEventArgs e)
            {
                TextRenderer.DrawText(e.Graphics, Text, Font, new Rectangle(Padding.Left, 0, Width - Padding.Horizontal, Height), ForeColor,
                    TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
            }
        }

        // ------------------------------------------------------------------ menus

        /// <summary>Flat white menu with rounded highlight rows, instead of the Office 2003 gradient look.</summary>
        public sealed class MenuRenderer : ToolStripProfessionalRenderer
        {
            public MenuRenderer() : base(new MenuColors()) { RoundedEdges = false; }

            protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e)
            {
                e.Graphics.Clear(Surface);
            }

            protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
            {
                using (var pen = new Pen(Line)) e.Graphics.DrawRectangle(pen, 0, 0, e.ToolStrip.Width - 1, e.ToolStrip.Height - 1);
            }

            protected override void OnRenderImageMargin(ToolStripRenderEventArgs e) { }

            protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
            {
                if (!e.Item.Selected || !e.Item.Enabled) return;
                var r = new Rectangle(4, 1, e.Item.Width - 8, e.Item.Height - 2);
                FillRound(e.Graphics, r, 8f, Background, Color.Empty);
            }

            protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
            {
                int y = e.Item.Height / 2;
                using (var pen = new Pen(Line)) e.Graphics.DrawLine(pen, 12, y, e.Item.Width - 12, y);
            }

            protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e)
            {
                Rectangle r = e.ImageRectangle;
                r.Inflate(4, 4);
                IconCheck(e.Graphics, r, Accent, 2.2f);
            }

            protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
            {
                e.TextColor = e.Item.Enabled ? Text : Faint;
                base.OnRenderItemText(e);
            }
        }

        private sealed class MenuColors : ProfessionalColorTable
        {
            public override Color MenuBorder { get { return Line; } }
            public override Color MenuItemBorder { get { return Color.Transparent; } }
            public override Color MenuItemSelected { get { return Background; } }
            public override Color ToolStripDropDownBackground { get { return Surface; } }
            public override Color ImageMarginGradientBegin { get { return Surface; } }
            public override Color ImageMarginGradientMiddle { get { return Surface; } }
            public override Color ImageMarginGradientEnd { get { return Surface; } }
            public override Color SeparatorDark { get { return Line; } }
            public override Color SeparatorLight { get { return Surface; } }
        }

        // ------------------------------------------------------------------ window chrome

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        /// <summary>
        /// Windows 11 rounds the corners of a borderless window only when asked. Older Windows (7, 8, 10) do not know
        /// the attribute: the call is skipped there, and any failure is ignored.
        /// </summary>
        public static void RoundCorners(IntPtr hwnd)
        {
            Version v = Environment.OSVersion.Version;
            if (v.Major < 10 || v.Build < 22000) return;
            try
            {
                int round = 2; // DWMWCP_ROUND
                DwmSetWindowAttribute(hwnd, 33, ref round, sizeof(int)); // DWMWA_WINDOW_CORNER_PREFERENCE
            }
            catch (Exception) { }
        }

        // ------------------------------------------------------------------ brand

        private static Icon _appIcon;

        /// <summary>The Sarfli icon embedded in the .exe (title bars, taskbar, dialogs).</summary>
        public static Icon AppIcon
        {
            get
            {
                if (_appIcon == null)
                {
                    try { _appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
                    catch (Exception) { _appIcon = SystemIcons.Application; }
                }
                return _appIcon;
            }
        }

        /// <summary>
        /// Draws the Sarfli mark (gold coin with a SIM card cut out, assets/brand/mark.svg) inside the box.
        /// The SIM is a hole, so it shows the background colour. Vector, so it stays sharp at any size.
        /// </summary>
        public static void DrawMark(Graphics g, RectangleF box, Color background)
        {
            // mark.svg geometry, viewBox -40..40 (coin radius 39.6, ring radius 34.1).
            float scale = Math.Min(box.Width, box.Height) / 80f;
            float cx = box.X + box.Width / 2f, cy = box.Y + box.Height / 2f;
            Func<float, float, PointF> P = (x, y) => new PointF(cx + x * scale, cy + y * scale);
            SmoothingMode old = g.SmoothingMode;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float r = 39.6f * scale;
            using (var gold = new SolidBrush(Gold)) g.FillEllipse(gold, cx - r, cy - r, 2 * r, 2 * r);
            float ring = 34.1f * scale;
            using (var pen = new Pen(GoldRing, Math.Max(1f, 1.6f * scale))) g.DrawEllipse(pen, cx - ring, cy - ring, 2 * ring, 2 * ring);
            using (var sim = new GraphicsPath())
            {
                // SIM outline with its cut corner (the tiny rounded corners of the SVG are invisible at icon sizes).
                sim.AddPolygon(new[]
                {
                    P(-16.66f, -10.72f), P(-14.35f, -14.28f), P(0.12f, -17.36f), P(2.38f, -16.94f), P(10.33f, -11.78f),
                    P(11.63f, -9.89f), P(16.26f, 11.92f), P(13.95f, 15.48f), P(-7.08f, 19.95f), P(-10.63f, 17.64f),
                });
                using (var hole = new SolidBrush(background)) g.FillPath(hole, sim);
            }
            g.SmoothingMode = old;
        }
    }
}
