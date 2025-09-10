import { logger } from '../../../lib/helpers/logger';
import { PlanApprovalService } from '../../../lib/services';
import { approvedPlan, PlanApprovalStatus } from '../../../lib/services';

export class PlanApprovalServiceImpl implements PlanApprovalService {

  public async approvePlan(planId: string): Promise<PlanApprovalStatus> {
    logger.info(`Got execution plan to approve: ${planId}`);
    return approvedPlan();
  }

}
