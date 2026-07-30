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
        
        [Workflow]
        public Configuration Execute()
        {
            services.OutputLoggerService.Log("Starting Workflow: GetConfiguration");
            var hasAssetDownloadFailures = false;
            var assetList = new List<string>() { assetConfiguration, assetCommonInsightsDataMap, assetAgentOrchestratorFolder, assetAgentProcessName};
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
                
                var jobData = GetRunningJobInformation();
                config.AutomationName = jobData.ProcessName;
            }
            catch(Exception e) {
                var messages = new Dictionary<String, Object>();
                messages.Add("JSONConfigurationString", jsonConfigString);
                messages.Add("ExceptionMessage", e.Message);
                
                services.OutputLoggerService.Log("Could not get the asset from Orchestrator", LogLevel.Fatal, messages);
                throw(e);
            }
            
            services.OutputLoggerService.Log("Adding Insights Data Map", LogLevel.Trace);
            var dataMap = new InsightsDataMap(assetSuccess[assetCommonInsightsDataMap].ToString());
            
            config.AddInsightsDataMap(dataMap);            
            services.OutputLoggerService.Log("Finished Workflow: GetConfiguration");
            
            return config;
        }
    }
}