using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Runtime.Serialization;
using System.Text;

namespace SarfliPos
{
    /// <summary>
    /// An API failure. Status 0 means the request never got a usable answer (network, timeout,
    /// unreadable body); such requests may or may not have reached the server.
    /// </summary>
    public sealed class ApiException : Exception
    {
        public int Status { get; private set; }
        public string Code { get; private set; }

        public ApiException(int status, string code, Exception inner = null)
            : base(code, inner)
        {
            Status = status;
            Code = code;
        }

        public bool IsUnauthorized { get { return Status == 401; } }

        /// <summary>Safe to send again with the same clientRef: no definite answer from the server.</summary>
        public bool IsRetryable { get { return Status == 0 || Status == 429 || Status >= 500; } }

        public string FriendlyMessage { get { return Strings.Error(Code); } }
    }

    /// <summary>
    /// Blocking HTTP client for the Sarfli POS API. Call it from a background thread only
    /// (the forms use Task.Run). Every call has a 20 s timeout.
    /// </summary>
    public sealed class ApiClient
    {
        private const int TimeoutMs = 20000;
        private readonly string _apiBase;
        private readonly string _token;

        public ApiClient(string apiBase, string token)
        {
            _apiBase = apiBase.TrimEnd('/');
            _token = token;
        }

        public PairResponse Pair(string code, string deviceName)
        {
            string body = Json.Serialize(new PairRequest { Code = code, DeviceName = deviceName });
            return Send<PairResponse>("POST", "/pair", body, false);
        }

        public MeResponse GetMe()
        {
            return Send<MeResponse>("GET", "/me", null, true);
        }

        public List<Recharge> GetRecharges(int limit)
        {
            var r = Send<RechargeListResponse>("GET", "/recharges?limit=" + limit, null, true);
            return r.Recharges ?? new List<Recharge>();
        }

        public Recharge GetRecharge(string id)
        {
            return Send<RechargeResponse>("GET", "/recharges/" + Uri.EscapeDataString(id), null, true).Recharge;
        }

        public Recharge CreateRecharge(CreateRechargeRequest request)
        {
            return Send<RechargeResponse>("POST", "/recharges", Json.Serialize(request), true).Recharge;
        }

        public Recharge CancelRecharge(string id)
        {
            return Send<RechargeResponse>("POST", "/recharges/" + Uri.EscapeDataString(id) + "/cancel", null, true)
                .Recharge;
        }

        private T Send<T>(string method, string path, string body, bool auth) where T : class
        {
            HttpWebRequest req;
            try
            {
                req = (HttpWebRequest)WebRequest.Create(_apiBase + path);
            }
            catch (Exception ex)
            {
                throw new ApiException(0, "bad_url", ex);
            }

            req.Method = method;
            req.Timeout = TimeoutMs;
            req.ReadWriteTimeout = TimeoutMs;
            req.Accept = "application/json";
            req.UserAgent = "SarfliPOS/1.0 (Windows)";
            req.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            if (auth) req.Headers[HttpRequestHeader.Authorization] = "Bearer " + _token;

            try
            {
                if (method == "POST")
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(body ?? "{}");
                    req.ContentType = "application/json";
                    req.ContentLength = bytes.Length;
                    using (Stream s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
                }

                using (var resp = (HttpWebResponse)req.GetResponse())
                {
                    string text = ReadBody(resp);
                    T result = Json.Deserialize<T>(text);
                    if (result == null) throw new ApiException(0, "bad_response");
                    return result;
                }
            }
            catch (WebException ex)
            {
                var resp = ex.Response as HttpWebResponse;
                if (resp == null)
                {
                    throw new ApiException(0, ex.Status == WebExceptionStatus.Timeout ? "timeout" : "network", ex);
                }
                using (resp)
                {
                    int status = (int)resp.StatusCode;
                    string code = null;
                    try
                    {
                        var err = Json.Deserialize<ErrorResponse>(ReadBody(resp));
                        if (err != null) code = err.Error;
                    }
                    catch (Exception) { }
                    throw new ApiException(status, string.IsNullOrEmpty(code) ? CodeForStatus(status) : code, ex);
                }
            }
            catch (IOException ex)
            {
                throw new ApiException(0, "network", ex);
            }
            catch (SerializationException ex)
            {
                // 200 with a body we cannot read (proxy page, truncated reply): treat as "no answer".
                throw new ApiException(0, "bad_response", ex);
            }
        }

        private static string ReadBody(HttpWebResponse resp)
        {
            using (Stream s = resp.GetResponseStream())
            using (var reader = new StreamReader(s, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        private static string CodeForStatus(int status)
        {
            switch (status)
            {
                case 400: return "bad_request";
                case 401: return "unauthorized";
                case 404: return "not_found";
                case 429: return "rate_limited";
                default: return status >= 500 ? "server_error" : "http_" + status;
            }
        }
    }
}
