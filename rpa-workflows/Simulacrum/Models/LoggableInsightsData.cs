using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using UiPath.Core;

namespace Simulacrum.Models
{
    public class LoggableInsightsData
    {
        public LoggableInsightsData(Configuration config, QueueItem item) {
            if(null == item) {
                throw new NullReferenceException("Missing a queue item to process");
            }
            Item = item;

            if(null == config.InsightsDataMapping)
                throw new NullReferenceException("Could not find an InsightsDataMap");
            
            InsightsDataMap map = config.InsightsDataMapping;
            
            // ======================================================================================
            try {
                CustomStringVariables = GetCustomVariablesDictionary(map.StringVariables);
                CustomNumberVariables = 
                    GetCustomVariablesDictionary(map.NumberVariables).
                    ToDictionary(x => x.Key, x => ParseInvariantNumber(x.Key, x.Value));
                
                CustomDataTimeVariables = 
                    GetCustomVariablesDictionary(map.DateTimeVariables).
                    ToDictionary(x => x.Key, x => ParseInvariantDateTime(x.Key, x.Value));

                CustomZipCodeVariables = GetCustomVariablesDictionary(map.ZipCodeVariables);
            }
            catch(Exception e) {
                throw;
            }            
        }
        
        public Dictionary<string, string> CustomStringVariables { get; set; }
        public Dictionary<string, Double> CustomNumberVariables { get; set; }
        public Dictionary<string, DateTime> CustomDataTimeVariables { get; set; }
        public Dictionary<string, string> CustomZipCodeVariables { get; set; }

        private static double ParseInvariantNumber(string fieldName, string value) {
            Double.TryParse(value, out var parsedValue);
            return parsedValue;
        }

        private static DateTime ParseInvariantDateTime(string fieldName, string value) {
            DateTime.TryParse(value, out var parsedValue);
            return parsedValue;
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
    
                    if(!sourceData.ContainsKey(sourceDataKey))              
                        continue;
                    
                    if(null == sourceData[sourceDataKey])
                        continue;
                    
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
