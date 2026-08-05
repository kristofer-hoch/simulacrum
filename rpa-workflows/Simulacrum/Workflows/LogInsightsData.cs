using System;
using System.Collections.Generic;
using UiPath.CodedWorkflows;
using Simulacrum.Models;

namespace Simulacrum.Workflows
{
    public class LogInsightsData : CodedWorkflow
    {
        /// <summary>
        /// Logs custom business intelligence fields for the current workflow run by adding the supplied
        /// String, numeric, date/time, and ZIP code values as structured log fields. Each collection is
        /// validated before logging, and protected UiPath log field names are skipped to avoid overwriting
        /// reserved execution log metadata.
        /// </summary>    
        [Workflow]
        public void Execute(Configuration config, LoggableInsightsData data)
        {
            Config = config;
            LogCustomVariableFields<String>(data.CustomStringVariables, InsightsVariableType.STRING);
            LogCustomVariableFields<Double>(data.CustomNumberVariables, InsightsVariableType.DOUBLE);
            LogCustomVariableFields<DateTime>(data.CustomDataTimeVariables, InsightsVariableType.DATETIME);
            LogCustomVariableFields<String>(data.CustomZipCodeVariables, InsightsVariableType.STRING);            
        }
        
        private Configuration Config { get; set; }
        
        /// <summary>
        /// Converts a collection of custom business intelligence values into structured log fields and
        /// writes them to the workflow log under the specified variable type name. Fields with protected
        /// UiPath log key names are skipped and reported as errors.
        /// </summary>
        /// <typeparam name="T">
        /// The value type of the custom variables being logged.
        /// </typeparam>
        /// <param name="customVariables">
        /// The custom variable names and values to add as structured log fields.
        /// </param>
        /// <param name="customVariableTypeName">
        /// A friendly name describing the type of custom variables being logged, such as String, Number,
        /// DateTime, or Zip Codes.
        /// </param>
        private void LogCustomVariableFields<T>(IDictionary<String, T> customVariables, InsightsVariableType customVariableType) 
        {
            var additionalLogFields = new Dictionary<string, object>();
            var ignoredKeys = new List<String>();
            
            // Later logged messages will need a reader-friendly version of the variable type.
            string friendlyNamedCustomVariableType;
            switch (customVariableType) {
                case InsightsVariableType.DATETIME:
                    friendlyNamedCustomVariableType = "DateTime";
                    break;
                case InsightsVariableType.DOUBLE:
                    friendlyNamedCustomVariableType = "Number";
                    break;
                case InsightsVariableType.ZIPCODE:
                    friendlyNamedCustomVariableType = "Zip Code";
                    break;     
                default:
                    friendlyNamedCustomVariableType = "String";
                    break;                
            }
            

            // #1 Check to see if the dictionary of variables is valid.
            var (isDictionaryValid,dictionaryInvalidMessage) = IsCustomVariableCollectionValid<T>(customVariables, friendlyNamedCustomVariableType);
            if(!isDictionaryValid) {
                services.OutputLoggerService.Log(dictionaryInvalidMessage, LogLevel.Trace, Config.StandardLogFields);
                return;
            }
            
            // #2 Iterate over the variables, separate protected log fields into their own dictionary.
            foreach(var logField in customVariables) {
                var key = logField.Key;
                
                // Ignore protected fields.
                if(IsLogFieldKeyProtected(key))
                {
                    ignoredKeys.Add(key);
                    continue;
                }
                
                if(!additionalLogFields.Keys.Contains(key))
                    additionalLogFields.Add(key, logField.Value);
            }
            
            // #3 Log a warning message that protected keys were in the dictionary
            if(0 < ignoredKeys.Count) {
                var fields = String.Join(", ", ignoredKeys);
                //throw new NotImplementedException("Have not included Log yet");
                var ignoredKeysMessage = String.Format("The following key(s) were ignored because they are protected, and reserved for standard logging: {0}", fields);
                services.OutputLoggerService.Log(ignoredKeysMessage, LogLevel.Error, Config.StandardLogFields);
            }
            
            // #4 Log the custom variables along with an appropriate message.
            var message = String.Format("Adding custom variables (Insights data type: {0}) to log", friendlyNamedCustomVariableType);
            services.OutputLoggerService.Log(message, LogLevel.Trace, additionalLogFields);
            
            
            return;
        }
        
        /// <summary>
        /// Determines whether a custom variable collection contains values that can be written as
        /// structured log fields. Null collections are treated as intentionally omitted, while empty
        /// collections are treated as a warning because no log fields can be created.
        /// </summary>
        /// <typeparam name="T">
        /// The value type contained in the custom variable collection.
        /// </typeparam>
        /// <param name="collection">
        /// The custom variable collection to validate.
        /// </param>
        /// <param name="customVariableTypeName">
        /// A friendly name describing the type of custom variables being validated.
        /// </param>
        /// <returns>
        /// <see langword="true"/> when the collection is not null and contains at least one item;
        /// otherwise, <see langword="false"/>.
        /// </returns>
        private (bool, String) IsCustomVariableCollectionValid<T>(IDictionary<String, T> collection, String customVariableTypeName) {
            String message = String.Format("{0} business intelligences data types were found and will be processedd.", customVariableTypeName);
            
            if(null == collection)
            {
                message = String.Format("Tried to create additional log fields for {0} BI data types, but found null instead. That was intentional, and this message is merely informative.", customVariableTypeName);
                return (false, message);  
            }
            
            if(0 == collection.Count)
            {
                message = String.Format("Tried to create additional log fields for {0} BI data types, but there were none to create. If that was intentional, then the developer should have passed null instead of an empty collection.", customVariableTypeName);
                return (false, message);  
            }
            
            return (true, message);
        }
        
        /// <summary>
        /// Determines whether a log field key matches a protected UiPath execution log field name that
        /// should not be overwritten by custom business intelligence data.
        /// </summary>
        /// <param name="key">
        /// The custom log field key to evaluate.
        /// </param>
        /// <returns>
        /// <see langword="true"/> when the key is reserved by UiPath logging; otherwise,
        /// <see langword="false"/>.
        /// </returns>
        private bool IsLogFieldKeyProtected(String key) {
            var lowerCaseKey = key.ToLowerInvariant();
            var protectedKeys = new List<String>() {
                "message", 
                "level", 
                "timestamp", 
                "jobid", 
                "processname", 
                "robotname", 
                "machinename"    
            };
            
            var isProtected = protectedKeys.Contains(lowerCaseKey);
            
            return isProtected;
        }        
    }

    public enum InsightsVariableType {
        STRING,
        DOUBLE,
        DATETIME,
        ZIPCODE
    }
}