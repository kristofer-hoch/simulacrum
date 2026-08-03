using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Simulacrum.Models
{

    public class Configuration
    {
        /// <summary>
        /// 
        /// </summary>
        /// <param name="configurationString"></param>
        public Configuration(String configurationString) {
            dynamic jObject = JsonConvert.DeserializeObject(configurationString);

            RawJsonString = configurationString;
            try {
                ConfigurationDocumentType = jObject.document_type;
                ConfigurationSchemaVersion = jObject.schema_version;
                AutomationId = jObject.automation.automation_id;
                AutomationName = jObject.automation.automation_name;
                AutomationDescription = jObject.automation.description;
                BusinessUnit = jObject.automation.category_path.category_1;
                
                DataInput = jObject.input_schema.ToString();
                DataOutput = jObject.output_schema.ToString();
                DataKPI = jObject.business_process_specific_kpis.ToString();

                // Applications
                Applications = new List<String>();
                foreach(JToken application in jObject.applications) {
                    Applications.Add(application.Value<String>("application_name"));
                }
                
                // DataSources
                DataSources = new List<String>();
                foreach(JToken dataSource in jObject.data_sources) {
                    DataSources.Add(dataSource.Value<String>("application"));
                }
                
                // Handle transactional.
                {
                    IsTransactional = false;
                    String executionModel = jObject.automation.execution_model.classification;
                    if(String.Equals(executionModel.ToLower(), "transactional")) {
                        IsTransactional = true;
                        QueueName = AutomationName.Replace(" ", "");
                    }
                }
                
            }
            catch(Exception e) {
                throw;
            }
            
            BuildStandardLogFields();
        }
        
        public void AddInsightsDataMap(InsightsDataMap dataMap) {
            InsightsDataMapping = dataMap;            
        }
        
        public IList<string> Applications { get; set; }

        public string AutomationId { get; private set; }
        
        public string AutomationName { get; set; }
        
        public string AutomationDescription { get; private set; }
        
        public string BusinessUnit { get; private set;}
        
        public string ConfigurationDocumentType { get; private set; }

        public string ConfigurationSchemaVersion { get; private set; }
        
        public string DataAgentOrchestratorFolder { get; set; }
        
        public string DataAgentProcessName { get; set; }
        
        public string DataInput { get; private set; }
        
        public IList<string> DataSources { get; set; }
        
        public string DataOutput { get; private set; }
        
        public string DataKPI { get; private set; }
        
        public InsightsDataMap InsightsDataMapping { get; private set; }
        
        public Boolean IsTransactional { get; private set; }
       
        public String QueueName { get; private set; }
 
        public string RawJsonString { get; private set; }
        
        public Dictionary<string, object> StandardLogFields { get; private set;}
        
        private void BuildStandardLogFields(){
            StandardLogFields = new Dictionary<string, object>();
            StandardLogFields.Add("AutomationName", AutomationName);
            StandardLogFields.Add("AutomationDescription", AutomationDescription);
            StandardLogFields.Add("BusinessUnit", BusinessUnit);
        }
    }
}