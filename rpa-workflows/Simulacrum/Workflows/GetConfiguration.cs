using System;
using System.Collections.Generic;
using UiPath.CodedWorkflows;
using Simulacrum.Models;

namespace Simulacrum.Workflows
{

    public class GetConfiguration : CodedWorkflow
    {
        private readonly string assetConfiguration = "Configuration";
        private readonly string assetCommonInsightsDataMap = "InsightsDataMap";
        private readonly string assetAgentOrchestratorFolder = "DataAgentFolder";
        private readonly string assetAgentProcessName = "DataAgentName";
        private readonly string assetAgentRequestedRecordCount = "DataAgentRequestedRecordCount";
        
        [Workflow]
        public Configuration Execute()
        {
            services.OutputLoggerService.Log("Starting Workflow: GetConfiguration");
            var hasAssetDownloadFailures = false;
            var assetList = new List<string>() { 
                assetConfiguration, 
                assetCommonInsightsDataMap, 
                assetAgentOrchestratorFolder, 
                assetAgentProcessName, 
                assetAgentRequestedRecordCount
            };
            
            var assetSuccess = new Dictionary<string, object>();
            
            foreach (var assetName in assetList) {
                try {
                    object assetValue = system.GetAsset(assetName);
                    assetSuccess.Add(assetName, assetValue);
                }
                catch(Exception e) {
                    var messages = new Dictionary<String, Object>();
                    messages.Add("AssetName", assetName);
                    messages.Add("ExceptionMessage", e.Message);
                    services.OutputLoggerService.Log("Could not get the asset from Orchestrator", LogLevel.Error, messages);
                    
                    hasAssetDownloadFailures = true;
                }
            }

            if(hasAssetDownloadFailures) {
                throw new Exception("Could not get assets from Orchestrator");
            }
            
            services.OutputLoggerService.Log("Building initial configuration object", LogLevel.Trace);
            string jsonConfigString = assetSuccess[assetConfiguration].ToString();
            Configuration config = null;
            try {
                config = new Configuration(jsonConfigString);
                config.DataAgentOrchestratorFolder = assetSuccess[assetAgentOrchestratorFolder].ToString();
                config.DataAgentProcessName = assetSuccess[assetAgentProcessName].ToString();              
            }
            catch(Exception e) {
                var messages = new Dictionary<String, Object>();
                messages.Add("JSONConfigurationString", jsonConfigString);
                messages.Add("ExceptionMessage", e.Message);
                
                services.OutputLoggerService.Log("Could not get the asset from Orchestrator", LogLevel.Fatal, messages);
                throw;
            }
            
            try {
                var recordsCount = (Int32) assetSuccess[assetAgentRequestedRecordCount];
                config.SetMockDataRecordsCount(recordsCount);
            }
            catch(Exception e) {
                var messages = new Dictionary<String, Object>();
                messages.Add("JSONConfigurationString", jsonConfigString);
                messages.Add("ExceptionMessage", e.Message);
                
                services.OutputLoggerService.Log("Could not convert records count", LogLevel.Fatal, messages);
                throw;
            }

            services.OutputLoggerService.Log("Adding Insights Data Map", LogLevel.Trace);
            var dataMap = new InsightsDataMap(assetSuccess[assetCommonInsightsDataMap].ToString());
            
            config.AddInsightsDataMap(dataMap);            
            services.OutputLoggerService.Log("Finished Workflow: GetConfiguration");
            
            return config;
        }
    }
}