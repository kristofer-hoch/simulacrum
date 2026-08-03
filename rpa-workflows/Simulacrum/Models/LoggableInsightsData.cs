using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using UiPath.Core;

namespace Simulacrum.Models
{
    public class LoggableInsightsData
    {
        private const NumberStyles AcceptedNumberStyles = NumberStyles.Float | NumberStyles.AllowThousands;
        private const string AcceptedNumberFormatDescription = "an invariant-culture number such as 1234.56, 1,234.56, or 1.25E3";

        private static readonly string[] AcceptedDateTimeFormats =
        {
            "yyyy-MM-dd",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF",
            "yyyy-MM-dd'T'HH:mm:ssK",
            "yyyy-MM-dd'T'HH:mm:ss.FFFFFFFK"
        };

        public LoggableInsightsData(Configuration config, QueueItem item) {
            Item = item;
            var map = config.InsightsDataMapping;
            
            // ======================================================================================
            try {
                CustomStringVariables = GetCustomVariablesDictionary(map.StringVariables);
            }
            catch(Exception e) {
                throw new Exception("Exception encountered while mapping CustomStringVariables", e);
            }

            // ======================================================================================
            try {                
                CustomNumberVariables = 
                    GetCustomVariablesDictionary(map.NumberVariables).
                    ToDictionary(x => x.Key, x => ParseInvariantNumber(x.Key, x.Value));
            }
            catch(Exception e) {
                throw new Exception("Exception encountered while mapping CustomNumberVariables", e);
            }

            // ======================================================================================
            try {
                CustomDataTimeVariables = 
                    GetCustomVariablesDictionary(map.DateTimeVariables).
                    ToDictionary(x => x.Key, x => ParseInvariantDateTime(x.Key, x.Value));
            }
            catch(Exception e) {
                throw new Exception("Exception encountered while mapping CustomDataTimeVariables", e);
            }

            // ======================================================================================
            try {
                CustomZipCodeVariables = GetCustomVariablesDictionary(map.ZipCodeVariables);
            }
            catch(Exception e) {
                throw new Exception("Exception encountered while mapping CustomZipCodeVariables", e);
            }
            
        }
        
        public Dictionary<string, string> CustomStringVariables { get; set; }
        public Dictionary<string, Double> CustomNumberVariables { get; set; }
        public Dictionary<string, DateTime> CustomDataTimeVariables { get; set; }
        public Dictionary<string, string> CustomZipCodeVariables { get; set; }

        private static double ParseInvariantNumber(string fieldName, string value) {
            if(Double.TryParse(value, AcceptedNumberStyles, CultureInfo.InvariantCulture, out var parsedValue))
                return parsedValue;

            throw new FormatException(
                $"Insights number field '{fieldName}' must contain {AcceptedNumberFormatDescription}.");
        }

        private static DateTime ParseInvariantDateTime(string fieldName, string value) {
            var dateTimeStyles = DateTimeStyles.AllowWhiteSpaces | DateTimeStyles.RoundtripKind;
            if(DateTime.TryParseExact(
                value,
                AcceptedDateTimeFormats,
                CultureInfo.InvariantCulture,
                dateTimeStyles,
                out var parsedValue))
                return parsedValue;

            throw new FormatException(
                $"Insights date/time field '{fieldName}' must use one of these invariant ISO formats: " +
                String.Join(", ", AcceptedDateTimeFormats) + ".");
        }
        
        /// <summary>
        /// Maps data from the transaction item to a new dictionary
        /// </summary>
        /// <param name="mappedVariables"></param>
        /// <returns></returns>
        private Dictionary<string, string> GetCustomVariablesDictionary(Dictionary<string, string> mappedVariables) {
            var results = new Dictionary<string, string>();
            if(null == mappedVariables)
                return results;
            
            if(mappedVariables.Count < 1)
                return results;
            
            //{
            //  "sourceDataKey": "customVariableKey",
            //	"account_id": "CustomVariableString001",
            //	"account_name": "CustomVariableString002"
            //}
            var sourceData = Item.SpecificContent;
            try {
                foreach(var sourceDataKey in mappedVariables.Keys) {
                    var customVariableKey = mappedVariables[sourceDataKey]; 
    
                    if(sourceData.ContainsKey(sourceDataKey))              
                        results.Add(customVariableKey, sourceData[sourceDataKey].ToString());
                }                
            }
            catch(Exception e)
            {
                throw new Exception("Exception caught while adding mapped data to dictionary", e);
            }
            
            return results;
        }
        
        private QueueItem Item { get; set; }
    }
}
