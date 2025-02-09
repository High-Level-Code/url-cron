import cron from "node-cron";
import fs from "node:fs";
import { Cronjob, DBCronjob } from "./modules/cronjob/types";
import { ENVIRONMENT, MAIN_SCHEDULE } from "./config";
import { getActiveSites, getFakeData } from "./modules/activeSites/queries";
import { generateTask } from "./modules/cronjob";
import { sendAlertEmail } from "./modules/email";

const installedCronjobs: Cronjob[] = [];

if (!MAIN_SCHEDULE) {
  console.error("> [ERROR] No schdule provided.");
  process.exit(1);
}
if (!cron.validate(MAIN_SCHEDULE)) {
  console.error("> [ERROR] Schedule provided is invalid.");
  process.exit(1);
}

const schedule = ENVIRONMENT.startsWith("prod") ?
  MAIN_SCHEDULE : "*/1 * * * *";

cron.schedule(schedule, async () => await main());
console.log(`> [LOG] Main cronjob installed successfully - at ${new Date()}\n`);

async function main() {
  console.log(">> Executing main cronjob ..");
  console.log(`> [LOG] Pulling endpoints from database ...`);
  const supabase = ENVIRONMENT.startsWith("prod") ?
    await getActiveSites() :
    getFakeData();

  // remove not listed cronjobs in the database
  console.log(`> [LOG] Checking already insalled cronjobs:`);
  installedCronjobs.length === 0 && console.log(" empty ...");
  installedCronjobs.length > 0 && installedCronjobs.forEach((job: Cronjob, index: number) => {
 
    const id = `${job.id}`;
    const details = JSON.stringify({id: job.id, endpoint: job.endpoint, reocurrence: job.recurrence});   
    console.log(`${details}`);

    const inDB = supabase.find((x) => x.id === job.id);
    if (inDB) return;

    job.cronTask!.stop();
    job.cronTask = null;
    delete job.cronTask;
    
    installedCronjobs.splice(index, 1);
    console.log(`> [SUCCESS] Removed cronjob with id ${job.id}. Cronjob details:`);
    console.log(`${details}\n`);
    try {
      fs.unlinkSync(`url-logs/${id}.txt`);
      console.log(`> [SUCCESS] Log file 'url-logs/${id}.txt' deleted.`)
    } catch (error) {
      console.error(`> [ERROR] Error deleting log file 'url-logs/${id}.txt'`)
    }
  });
  console.log("\n");


  console.log(`> [LOG] Checking each pulled ednpoint:`);

  let update = false;
  
  supabase.forEach((data: DBCronjob, index: number) => {

    // validate data
    console.log(`>>> index ${index}`);
    console.log(`--> Data: `, data);
    const id = data.id;
    const endpoint = `${data.website!}/${data.apiEndpoint!}`;
    const recurrence = data.recurrence!;
   
    if (!cron.validate(recurrence)) {
      console.log(`> [ERROR] ${recurrence} - is not a valid schedule expression. Skipping ... Details:`)
      sendAlertEmail(`invalid schedule expression from data pulled. Detals: endpoint -> ${endpoint}`, "logs.txt");
      return;
    };

    const installedCron = installedCronjobs.find((x) => x.id === id);

    const task = generateTask(endpoint, id, recurrence);

    if (!installedCron) {
      
      installedCronjobs.push({
        id,
        endpoint,
        recurrence,
        cronTask: cron.schedule(recurrence, task)
      });
      
      console.log(`--> Endpoint successfully installed as a cronjob - at ${new Date()} - Details:`);
      console.log(`     id: ${id}`);
      console.log(`     endpoint: ${endpoint}`);
      console.log(`     recurrence: ${recurrence}`);
      
      const logFolder = "url-logs"
      if (!fs.existsSync(logFolder)) fs.mkdirSync(logFolder, { recursive: true });
      fs.appendFileSync(`${logFolder}/${id}.txt`, `File created at ${new Date()}\n`);
      return;
    }

    if (installedCron) {
      console.log("--> Pulled endpoint located in installed cronjob. Checking for updateds...");
      console.log(` - endpoint updated? 
                  installed = ${installedCron.endpoint} 
                  puled = ${endpoint}
      `);
      console.log(` - recurrence updated? 
                  installed = ${installedCron.recurrence} 
                  puled = ${recurrence}
      `);
      if (endpoint === installedCron.endpoint && recurrence === installedCron.recurrence) 
        return console.log(`--> Nothing to update. skipping ..`);
      console.log(`--> Cronjob with id ${id} is being updated [${new Date()}]:`);
      console.log(`   endpoint: ${installedCron.endpoint} -> ${endpoint}`);
      console.log(`   recurrence: ${installedCron.recurrence} -> ${recurrence}\n`);

      fs.appendFileSync(`url-logs/${id}.txt`, `
        [CRONJOB] Cronjob was updated at - ${new Date()}. Details:
          endpoint: ${installedCron.endpoint} -> ${endpoint}
          recurrence: ${installedCron.recurrence} -> ${recurrence}\n
      `)

      installedCron.cronTask!.stop();
      installedCron.cronTask = null;
      delete installedCron.cronTask;

      installedCron.endpoint = `${data.website}/${data.apiEndpoint}`;
      installedCron["cronTask"] = cron.schedule(recurrence, task);
      update = true;
      return;
    }
    
  });

  if (installedCronjobs.length === 0) console.log(`\n> [LOG] No new cronjobs installed.\n`);
  if (!update) console.log(`\n> [LOG] No cronjob updates made.\n`);

  console.log(`> [LOG] Cronjobs installed [${new Date()}]:`);
  installedCronjobs.forEach((job: Cronjob) => {
    if (!job) return console.log("no cronjob");
    console.log(JSON.stringify({id: job.id, endpoint: job.endpoint, recurrence: job.recurrence}));
  });

  console.log("\n");
  console.log(">> End of main cronjob execution");
  console.log("\n");
}

