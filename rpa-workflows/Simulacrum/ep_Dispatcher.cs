using System;
using System.Collections.Generic;
using UiPath.CodedWorkflows;
using UiPath.Core;
using Simulacrum.Common;
using Simulacrum.Models;

namespace Simulacrum
{
    public class ep_Dispatcher : CodedWorkflow
    {
        private const string workflowType = "Dispatcher";
        
        [Workflow]
        public void Execute()
        {
            try {
                services.OutputLoggerService.Log(string.Format("Starting workflow: {0}", workflowType));

                services.OutputLoggerService.Log("Getting configuration for the automation", LogLevel.Info, StandardLogFields);
                Config = workflows.GetConfiguration(false);
                StandardLogFields = UtilityHelpers.GetAdditionalLogFields(Config);
                
                services.OutputLoggerService.Log(string.Format("Executing Process: {0}", Config.AutomationName), LogLevel.Info, StandardLogFields);
                
                services.OutputLoggerService.Log("Downloading data from the Agent", LogLevel.Trace, StandardLogFields);
                var agentData = workflows.GetAgentData(Config);
                
                services.OutputLoggerService.Log("Creating queue items from the Agent data ", LogLevel.Trace, StandardLogFields);
                foreach(var specificContent in agentData.InputData) {
                    var reference = Guid.NewGuid().ToString();
                    
                    services.OutputLoggerService.Log(string.Format("Adding queue item with Reference: {0}", reference), LogLevel.Trace, StandardLogFields);
                    system.AddQueueItem(
                        Config.QueueName, 
                        string.Empty, 
                        DateTime.Now.AddDays(2), 
                        specificContent, 
                        DateTime.Now.AddSeconds(-1), 
                        QueueItemPriority.Normal, 
                        reference, 
                        10000);
                }
                services.OutputLoggerService.Log(string.Format("Finished workflow: {0}", workflowType));                
            }
            catch (Exception e) {
                services.OutputLoggerService.Log(string.Format("Exception in '{0}' workflow: {1}", workflowType, e.Message));
                workflows.GlobalException(e);
            }
        }
        
        private Configuration Config { get; set; }
        
        private Dictionary<string, object> StandardLogFields { get; set; }
    }
}