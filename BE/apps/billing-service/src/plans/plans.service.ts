// plans.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from './entities/plan.entity';

@Injectable()
export class PlansService {
  constructor(@InjectRepository(Plan) private repo: Repository<Plan>) {}

  findAll() { return this.repo.find({ where: { isActive: true } }); }
  findById(id: string) { return this.repo.findOne({ where: { id } }); }
  findByName(name: string) { return this.repo.findOne({ where: { name } }); }
}
