using System;
using System.Collections.Generic;
using UiPath.CodedWorkflows;
using UiPath.Core;

using Simulacrum.Common;
using Simulacrum.Models;

namespace Simulacrum
{
    public class ep_SingleJob : CodedWorkflow
    {
        [Workflow]
        public void Execute()
        {                
            services.OutputLoggerService.Log("Starting the process");
            
            try {
                services.OutputLoggerService.Log("Getting the process configuration");
                Config = workflows.GetConfiguration(false);
            }
            catch(Exception e) {
                var message = string.Format("Could not get configuration at the start of the process: {0}", e.Message);
                services.OutputLoggerService.Log(message, LogLevel.Fatal, null);

                workflows.GlobalException(e);
                
                throw e;
            }
            
            try {
                StandardLogFields = UtilityHelpers.GetAdditionalLogFields(Config);
                
                services.OutputLoggerService.Log(string.Format("Executing Process: {0}", Config.AutomationName), LogLevel.Info, StandardLogFields);
                
                services.OutputLoggerService.Log("Downloading data from the Agent", LogLevel.Trace, StandardLogFields);
                var agentData = workflows.GetAgentData(Config);
                
                services.OutputLoggerService.Log("Processing data from the Agent", LogLevel.Trace, StandardLogFields);
                var sessionReference = Guid.NewGuid().ToString();
                foreach(var specificContent in agentData.InputData) {
                    
                    var results = Process(sessionReference, specificContent);
                    
                    Boolean shouldStop = workflows.ShouldStop();
                    if(shouldStop) {
                        services.OutputLoggerService.Log("Recieved stop request from Orchestator.", LogLevel.Warn, StandardLogFields);
                        break;
                    }
                }
                
                services.OutputLoggerService.Log("Process completed");                
            }
            catch (Exception e) {
                services.OutputLoggerService.Log(string.Format("Exception: {0}", e.Message));
                workflows.GlobalException(e);
                
                throw e;
            }
        }
        
        /// <summary>
        /// 
        /// </summary>
        private Configuration Config { get; set; }
        
        private Dictionary<string, object> StandardLogFields { get; set; }
        
        /// <summary>
        /// 
        /// </summary>
        /// <param name="sessionReference"></param>
        /// <param name="specificContent"></param>
        /// <returns></returns>
        private ProcessExecutionResults Process(string sessionReference, Dictionary<string, object> specificContent) {
            var queueItem = new QueueItem();
            queueItem.Reference = sessionReference;
            queueItem.SpecificContent = specificContent;

            var results = new ProcessExecutionResults(queueItem);
            var output = new Dictionary<string, object>();

            var attemptProcess = true;
            var attemptNumber = 1;
            while(attemptProcess)
            {
                attemptNumber++;
                attemptProcess = attemptNumber < 3;
                
                results = workflows.Process(Config, queueItem);
    
                if(results.TransactionItem.Status == QueueItemStatus.Successful)
                    attemptProcess = false;
            }
            
            results.TransactionItem.Output = output;
            return results;
        }
    }
}