using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Simulacrum.Models
{
    public class AgentData
    {
        public AgentData(string rawJson) {
            RawJsonString = rawJson;
            
            if (string.IsNullOrWhiteSpace(rawJson)) {
                throw new ArgumentException("The JSON input cannot be empty.", nameof(rawJson));
            }
    
            // The attached file is itself a JSON-encoded string.
            JToken envelopeToken = ParseToken(rawJson);
    
            if (envelopeToken.Type == JTokenType.String) {
                string envelopeJson = envelopeToken.Value<string>();
                envelopeToken = ParseToken(envelopeJson);
            }
    
            JObject envelope = envelopeToken as JObject ?? throw new InvalidOperationException("The outer JSON must be an object.");
    
            // mockData is another JSON-encoded string.
            JToken mockDataToken = envelope["mockData"] ?? throw new InvalidOperationException("The mockData property is missing.");
    
            if (mockDataToken.Type == JTokenType.String) {
                string mockDataJson = mockDataToken.Value<string>();
                mockDataToken = ParseToken(mockDataJson);
            }
    
            JObject mockData = mockDataToken as JObject ?? throw new InvalidOperationException("mockData must contain a JSON object.");
    
            JArray inputRecords = mockData["input_records"] as JArray ?? throw new InvalidOperationException("The input_records array is missing.");
    
            // Convert each JSON object into Dictionary<string, string>.
            // JSON null values become empty strings.
            InputData = inputRecords
                .OfType<JObject>()
                .Select(record =>
                    record.Properties().ToDictionary(
                        property => property.Name,
                        property => (object) property.Value))
                .ToList();
        }
        
        private string ConvertTokenToString(JToken token)
        {
            if (token.Type == JTokenType.Null || token.Type == JTokenType.Undefined) {
                return string.Empty;
            }
    
            if (token.Type == JTokenType.String) {
                var tokenValue = token.Value<string>() ?? string.Empty;
                return tokenValue;
            }
    
            return token.ToString(Formatting.None);
        } 
        
        private JToken ParseToken(string json)
        {
            JToken token = JsonConvert.DeserializeObject<JToken>(json);    
            var tokenValue = token ?? throw new InvalidOperationException("The JSON could not be deserialized.");
            return tokenValue;
        }
        
        public string RawJsonString { get; private set; }
        
        public List<string> DataKeys { get; private set; }
        
        public List<Dictionary<string, object>> InputData { get; private set; }
    }
}