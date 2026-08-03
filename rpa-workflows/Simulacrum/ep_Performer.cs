using System;
using System.Collections.Generic;
using UiPath.CodedWorkflows;
using UiPath.Core;
using Simulacrum.Models;

namespace Simulacrum
{
    public class ep_Performer : CodedWorkflow
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
                
                services.OutputLoggerService.Log("Process completed");                
            }
            catch (Exception e) {
                services.OutputLoggerService.Log(string.Format("Exception: {0}", e.Message));
                workflows.GlobalException(e);
                
                throw e;
            }
        }
        
        private Configuration Config { get; set; }
        
        private Dictionary<string, object> StandardLogFields { get; set; }
    }
}