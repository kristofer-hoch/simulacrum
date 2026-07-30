using System;
using System.Collections.Generic;
using UiPath.CodedWorkflows;
using UiPath.Core;
using Simulacrum.Models;

namespace Simulacrum
{
    public class ep_Performer : CodedWorkflow
    {
        private const string workflowType = "Performer";
        
        [Workflow]
        public void Execute()
        {
            try {
                services.OutputLoggerService.Log(string.Format("Starting workflow: {0}", workflowType));
                Config = workflows.GetConfiguration(false);
                
                while(1 == 1) {
                    var newTransactionItem = workflows.GetTransaction(Config);
                    if(null == newTransactionItem)
                        break;
                    
                    var executionResults = workflows.Process(Config, newTransactionItem);
                    var workingTransactionItem = executionResults.TransactionItem;
                    try {
                        if(workingTransactionItem.Status == QueueItemStatus.Successful) {
                            system.SetTransactionStatus(workingTransactionItem, ProcessingStatus.Successful);
                        }
                        else {
                            system.SetTransactionStatus(
                                workingTransactionItem, 
                                ProcessingStatus.Failed, 
                                string.Empty,
                                workingTransactionItem.SpecificContent,
                                null,
                                executionResults.Details,
                                executionResults.TransactionErrorType,
                                executionResults.Reason,
                                10000);
                        }                        
                    }
                    catch(Exception e){
                        throw new Exception("Could not set the transaction status", e);
                    }

                }
                
                services.OutputLoggerService.Log(string.Format("Finished workflow: {0}", workflowType));                
            }
            catch (Exception e) {
                var message = string.Format("Exception in '{0}' workflow: {1}", workflowType, e.Message);
                services.OutputLoggerService.Log(message, LogLevel.Fatal, Config.StandardLogFields);
                workflows.GlobalException(e);
            }
        }
        
        private Configuration Config { get; set; }
        
        private Dictionary<string, object> StandardLogFields { get; set; }
    }
}