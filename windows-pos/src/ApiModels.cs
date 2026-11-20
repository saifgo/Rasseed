using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;

// JSON shapes from API.md. Field names match the wire format exactly.
namespace SarfliPos
{
    [DataContract]
    public sealed class PairRequest
    {
        [DataMember(Name = "code", Order = 1)] public string Code;
        [DataMember(Name = "deviceName", Order = 2)] public string DeviceName;
    }

    [DataContract]
    public sealed class Terminal
    {
        [DataMember(Name = "id")] public string Id;
        [DataMember(Name = "name")] public string Name;
        /// <summary>Set by the owner on sarfli.com: most this PC may spend per day. Null = no limit (GET /me only).</summary>
        [DataMember(Name = "dailyLimitMillimes")] public long? DailyLimitMillimes;
        [DataMember(Name = "spentTodayMillimes")] public long SpentTodayMillimes;
    }

    [DataContract]
    public sealed class PairResponse
    {
        [DataMember(Name = "token")] public string Token;
        [DataMember(Name = "terminal")] public Terminal Terminal;
    }

    [DataContract]
    public sealed class UserInfo
    {
        [DataMember(Name = "name")] public string Name;
        [DataMember(Name = "email")] public string Email;
    }

    [DataContract]
    public sealed class Operator
    {
        [DataMember(Name = "code")] public string Code;
        [DataMember(Name = "name")] public string Name;
        [DataMember(Name = "color")] public string Color;
        /// <summary>Used only to grey out what cannot be paid. Never shown to the cashier.</summary>
        [DataMember(Name = "balanceMillimes")] public long BalanceMillimes;
        /// <summary>Same as BalanceMillimes, for Internet packages (SIMs may be allowed Light only, or Internet only). Null on older servers.</summary>
        [DataMember(Name = "dataBalanceMillimes")] public long? DataBalanceMillimes;
        [DataMember(Name = "rechargeEnabled")] public bool RechargeEnabled;
        /// <summary>Admin cap on one Light recharge for this operator. Null = no cap.</summary>
        [DataMember(Name = "maxRechargeMillimes")] public long? MaxRechargeMillimes;
    }

    [DataContract]
    public sealed class Package
    {
        [DataMember(Name = "id")] public string Id;
        [DataMember(Name = "operatorCode")] public string OperatorCode;
        [DataMember(Name = "name")] public string Name;
        [DataMember(Name = "priceMillimes")] public long PriceMillimes;
    }

    [DataContract]
    public sealed class MeResponse
    {
        [DataMember(Name = "terminal")] public Terminal Terminal;
        [DataMember(Name = "user")] public UserInfo User;
        /// <summary>"sarfli" = admin terminal spending Sarfli's own credit; "balance" = a buyer's own balance.</summary>
        [DataMember(Name = "source")] public string Source;
        [DataMember(Name = "operators")] public List<Operator> Operators;
        [DataMember(Name = "packages")] public List<Package> Packages;
    }

    /// <summary>Either a plain recharge (operatorCode + amountMillimes) or a package (packageId).</summary>
    [DataContract]
    public sealed class CreateRechargeRequest
    {
        [DataMember(Name = "operatorCode", EmitDefaultValue = false, Order = 1)] public string OperatorCode;
        [DataMember(Name = "packageId", EmitDefaultValue = false, Order = 2)] public string PackageId;
        [DataMember(Name = "msisdn", Order = 3)] public string Msisdn;
        [DataMember(Name = "amountMillimes", EmitDefaultValue = false, Order = 4)] public long? AmountMillimes;
        [DataMember(Name = "clientRef", Order = 5)] public string ClientRef;
    }

    [DataContract]
    public sealed class Recharge
    {
        [DataMember(Name = "id")] public string Id;
        [DataMember(Name = "ref")] public string Ref;
        [DataMember(Name = "operatorCode")] public string OperatorCode;
        [DataMember(Name = "msisdn")] public string Msisdn;
        [DataMember(Name = "amountMillimes")] public long AmountMillimes;
        [DataMember(Name = "packageName")] public string PackageName;
        [DataMember(Name = "status")] public string Status;
        /// <summary>Why a failed recharge failed, when the cashier should know: "number_not_compatible" or null.</summary>
        [DataMember(Name = "failReason")] public string FailReason;
        [DataMember(Name = "createdAt")] public string CreatedAt;
        [DataMember(Name = "completedAt")] public string CompletedAt;

        public bool IsLive { get { return Status == "queued" || Status == "sending"; } }
    }

    [DataContract]
    public sealed class RechargeResponse
    {
        [DataMember(Name = "recharge")] public Recharge Recharge;
    }

    [DataContract]
    public sealed class RechargeListResponse
    {
        [DataMember(Name = "recharges")] public List<Recharge> Recharges;
    }

    [DataContract]
    public sealed class ErrorResponse
    {
        [DataMember(Name = "error")] public string Error;
    }

    internal static class Json
    {
        public static string Serialize<T>(T value)
        {
            var ser = new DataContractJsonSerializer(typeof(T));
            using (var ms = new MemoryStream())
            {
                ser.WriteObject(ms, value);
                return Encoding.UTF8.GetString(ms.ToArray());
            }
        }

        public static T Deserialize<T>(string json)
        {
            var ser = new DataContractJsonSerializer(typeof(T));
            using (var ms = new MemoryStream(Encoding.UTF8.GetBytes(json)))
            {
                return (T)ser.ReadObject(ms);
            }
        }
    }
}
