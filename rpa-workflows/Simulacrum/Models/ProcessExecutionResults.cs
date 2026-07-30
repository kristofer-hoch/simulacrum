using System;
using UiPath.Core;
using UiPath.Core.Activities;

namespace Simulacrum.Models
{

    public class ProcessExecutionResults
    {
        public ProcessExecutionResults(QueueItem transactionItem) {
            TransactionItem = transactionItem;
            BusinessException = null;
            SystemException = null;
        }
        
        public string Details { get; set; }
        public string Reason { get; set; }
        public ErrorType TransactionErrorType { get; set; }
        public QueueItem TransactionItem { get; private set; }
        public BusinessRuleException BusinessException { get; set; }
        public Exception SystemException { get; set; }
    }
}