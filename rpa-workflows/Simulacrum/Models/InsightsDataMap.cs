using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace Simulacrum.Models
{
    public class InsightsDataMap
    {
        public InsightsDataMap(string dataMapJson) {
            var categories = 
                JsonConvert.DeserializeObject<Dictionary<string, Dictionary<string, string>>>(dataMapJson) ?? 
                throw new InvalidOperationException("The JSON could not be parsed.");

            StringVariables = categories["string"];
            NumberVariables = categories["number"];
            DateTimeVariables = categories["datetime"];
            ZipCodeVariables = categories["zipcode"];
        }
        
        public Dictionary<string, string> StringVariables { get; private set;}
        public Dictionary<string, string> NumberVariables { get; private set;}
        public Dictionary<string, string> DateTimeVariables { get; private set;}
        public Dictionary<string, string> ZipCodeVariables { get; private set;}
    }
}