using System;
using System.Collections.Generic;
using System.Data;
using UiPath.Activities.System.Jobs.Coded;
using UiPath.CodedWorkflows;
using UiPath.Core;
using UiPath.Core.Activities.Storage;
using UiPath.Orchestrator.Client.Models;

namespace Simulacrum.Workflows
{
    public class GlobalException : CodedWorkflow
    {
        [Workflow]
        public void Execute(Exception e)
        {
            services.OutputLoggerService.Log("Logging complete exception trace");
            FirstExceptionFirst(e);

        }
        
        private void FirstExceptionFirst(Exception e)
        {
            if(null != e.InnerException)
                FirstExceptionFirst(e.InnerException);
            
            var additionalLogFields = new Dictionary<string, object>();
            additionalLogFields.Add("ExceptionMessage", e.Message);
            additionalLogFields.Add("ExceptionSource", e.Source);
            additionalLogFields.Add("ExceptionStackTrace", e.StackTrace);

            services.OutputLoggerService.Log(string.Format("Global Exception: {0}", e.Message), LogLevel.Trace, additionalLogFields);
        }
    }
}