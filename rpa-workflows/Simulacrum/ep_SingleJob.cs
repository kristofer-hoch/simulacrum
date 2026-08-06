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
            
            var recordsProcessed = 0;
            var recordsToProcess = 0;
            
            try {
                try {
                    services.OutputLoggerService.Log("Getting the process configuration");
                    Config = workflows.GetConfiguration(false);
                }
                catch(Exception e) {
                    var message = string.Format("Could not get configuration at the start of the process: {0}", e.Message);
                    services.OutputLoggerService.Log(message, LogLevel.Fatal, null);
                    throw;
                }
                
                StandardLogFields = UtilityHelpers.GetAdditionalLogFields(Config);
                
                services.OutputLoggerService.Log("Downloading data from the Agent", LogLevel.Trace, StandardLogFields);
                var agentData = workflows.GetAgentData(Config);
                recordsToProcess = agentData.InputData.Count;
                
                services.OutputLoggerService.Log("Processing data from the Agent", LogLevel.Trace, StandardLogFields);
                var sessionReference = Guid.NewGuid().ToString();
                foreach(var specificContent in agentData.InputData) {
                    Boolean shouldStop = workflows.ShouldStop();
                    if(shouldStop) {
                        services.OutputLoggerService.Log("Recieved stop request from Orchestator.", LogLevel.Warn, StandardLogFields);
                        break;
                    }
                    
                    services.OutputLoggerService.Log(String.Format("Processing record {0} of {1}.", recordsProcessed, recordsToProcess), LogLevel.Trace, StandardLogFields);

                    // I don't need to try/catch here because that logic is handled in ProcessRecord
                    ProcessRecord(sessionReference, specificContent, 1);
                    
                    recordsProcessed++;
                }
                
                services.OutputLoggerService.Log(String.Format("Processed {0} records of {1}.", recordsProcessed, recordsToProcess), LogLevel.Info, StandardLogFields);          
                services.OutputLoggerService.Log("Process completed", LogLevel.Info, StandardLogFields);                
            }
            catch (Exception e) {
                services.OutputLoggerService.Log(string.Format("Exception: {0}", e.Message));
                workflows.GlobalException(e);
                
                throw;
            }
        }
        
        private Configuration Config { get; set; }
        
        private Dictionary<string, object> StandardLogFields { get; set; }
        
        private void ProcessRecord(string sessionReference, Dictionary<string, object> specificContent, Int32 attemptNumber) {
            Int32 maxRetries = 3;
            var queueItem = new QueueItem();
            queueItem.Reference = sessionReference;
            queueItem.SpecificContent = specificContent;
            
            try {         
                workflows.Process(Config, queueItem);
            }
            catch(BusinessRuleException bre) {
                if(attemptNumber > 3)
                    throw;
                
                attemptNumber++;
                
                var additionalLogFields = new Dictionary<string, object>();
                additionalLogFields.Add("ProcessExecution_ExceptionMessage", bre.Message);
                additionalLogFields.Add("ProcessExecution_AttemptNumber", attemptNumber);
                services.OutputLoggerService.Log(String.Format("Retry attempt {0} of {1}", attemptNumber, maxRetries), LogLevel.Error, additionalLogFields);
                
                // Recursion until we reach maxRetries
                ProcessRecord(sessionReference, specificContent, attemptNumber);
            }
            catch(Exception e) {
                throw;                        
            }
        }
    }
}