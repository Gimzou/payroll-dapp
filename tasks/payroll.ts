import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

task("payroll:info", "Print FHEPayroll and FHEToken deployment addresses").setAction(async function (
  _taskArguments: TaskArguments,
  hre,
) {
  const { deployments } = hre;
  try {
    const payroll = await deployments.get("FHEPayroll");
    const token = await deployments.get("FHEToken");
    console.log(`FHEPayroll : ${payroll.address}`);
    console.log(`FHEToken   : ${token.address}`);
  } catch {
    console.error("Contracts not found. Run: npx hardhat deploy --network <network>");
  }
});

task("payroll:employees", "List all registered employees and their employment status")
  .addOptionalParam("address", "Optionally specify the FHEPayroll contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { ethers, deployments } = hre;
    const STATUS_LABELS: Record<number, string> = { 0: "None", 1: "Active", 2: "Paused", 3: "Terminated" };

    const deployment = taskArguments.address
      ? { address: taskArguments.address as string }
      : await deployments.get("FHEPayroll");

    const signers = await ethers.getSigners();
    const payroll = await ethers.getContractAt("FHEPayroll", deployment.address, signers[0]);

    let count = 0;
    while (true) {
      try {
        const addr: string = await payroll.employeeList(count);
        const emp = await payroll.getEmployee(addr);
        const status = STATUS_LABELS[Number(emp.status)] ?? "Unknown";
        const hired = new Date(Number(emp.hiredAt) * 1000).toISOString();
        console.log(`#${count + 1}  ${addr}  status=${status}  hired=${hired}`);
        count++;
      } catch {
        break;
      }
    }

    if (count === 0) {
      console.log("No employees registered.");
    } else {
      console.log(`\nTotal: ${count} employee(s)`);
    }
  });
