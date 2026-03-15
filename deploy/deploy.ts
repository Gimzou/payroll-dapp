import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("Deploying FHEToken...");
  const token = await deploy("FHEToken", {
    from: deployer,
    args: [
      deployer, // owner
      1000000000, // initial amount (as scalar, will be encrypted in constructor)
      "Confidential USDC", // name
      "cUSDC", // symbol
      "" // tokenURI
    ],
    log: true,
  });

  console.log("Deploying FHEPayroll...");
  const payroll = await deploy("FHEPayroll", {
    from: deployer,
    args: [
      token.address,
      deployer // employer
    ],
    log: true,
  });

  console.log("-----------------------------------------");
  console.log("Deployment Complete!");
  console.log("FHEToken Address: ", token.address);
  console.log("FHEPayroll Address: ", payroll.address);
  console.log("-----------------------------------------");
  console.log("IMPORTANT: Update these in frontend/web/src/lib/contracts.ts");
};

export default func;
func.id = "deploy_payroll_v3";
func.tags = ["Payroll"];
