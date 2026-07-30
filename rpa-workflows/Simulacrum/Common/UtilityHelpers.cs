using System.Collections.Generic;
using Simulacrum.Models;

namespace Simulacrum.Common
{
    public static class UtilityHelpers
    {
        public static Dictionary<string, object> GetAdditionalLogFields(Configuration config) {
            var logFields = GetAdditionalLogFields(config, new Dictionary<string, object>());
            return logFields;
        }
        
        public static Dictionary<string, object> GetAdditionalLogFields(Configuration config, Dictionary<string, object> additionalLogFields) {
            var logFields = new Dictionary<string, object>();

            if(null != config)
                logFields = config.StandardLogFields;
            
            if(null != additionalLogFields) {
                foreach(var key in additionalLogFields.Keys) {
                    var value = additionalLogFields[key];
                    if(logFields.ContainsKey(key))
                        logFields[key] = value;
                    else
                        logFields.Add(key, value);
                }
            }
            
            return logFields;
        }
    }
}